/**
 * Agent 调用适配器
 * 
 * 根据 URL scheme 自动选择协议：
 * - http:// / https:// → OpenAI 兼容格式
 * - acp://             → ACP (Agent Communication Protocol)
 * - cli://codex        → 内置 Codex CLI 适配器
 * - cli://gemini       → 内置 Gemini CLI 适配器
 */

import { execFile, spawn } from "node:child_process";
import { writeFile, readFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

/**
 * 统一调用接口 — 根据 URL 自动选择适配器
 */
export async function callAgentAuto(url, messages) {
  if (url.startsWith("acp://")) return callACP(url, messages);
  if (url.startsWith("cli://")) return callCLI(url, messages);
  return callOpenAI(url, messages);
}

/**
 * 验证 Agent 是否可达
 */
export async function checkAgent(url) {
  if (url.startsWith("acp://")) {
    const { httpUrl } = parseACPUrl(url);
    const res = await fetch(`${httpUrl}/agents`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`ACP server 不可达: ${res.status}`);
    return;
  }
  if (url.startsWith("cli://")) {
    const name = url.replace("cli://", "");
    const cmd = { codex: "codex", gemini: "gemini", claude: "claude", openclaw: "openclaw" }[name] || name;
    return new Promise((resolve, reject) => {
      execFile(cmd, ["--version"], { timeout: 5000 }, (err) => {
        if (err) reject(new Error(`${cmd} CLI 未安装（npm install -g ${{
          codex: "@openai/codex", gemini: "@google/gemini-cli", claude: "@anthropic-ai/claude-code", openclaw: "openclaw"
        }[name] || cmd}）`));
        else resolve();
      });
    });
  }
  await fetch(url, { signal: AbortSignal.timeout(5000) });
}

// ========== OpenAI 适配器 ==========

async function callOpenAI(agentUrl, messages) {
  const res = await fetch(`${agentUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "(empty response)";
}

// ========== ACP 适配器 ==========

function parseACPUrl(acpUrl) {
  const withoutScheme = acpUrl.replace(/^acp:\/\//, "");
  const slashIdx = withoutScheme.indexOf("/");
  if (slashIdx === -1) throw new Error(`无效的 ACP URL: ${acpUrl}`);
  return { httpUrl: `http://${withoutScheme.slice(0, slashIdx)}`, agentName: withoutScheme.slice(slashIdx + 1) };
}

async function callACP(acpUrl, messages) {
  const { httpUrl, agentName } = parseACPUrl(acpUrl);
  const input = messages.map((msg) => {
    if (typeof msg.content === "string") {
      return { parts: [{ content: msg.content, content_type: "text/plain" }] };
    }
    const parts = [];
    for (const item of msg.content) {
      if (item.type === "text") parts.push({ content: item.text, content_type: "text/plain" });
      else if (item.type === "image_url") parts.push({ content: item.image_url.url, content_type: "image/jpeg" });
    }
    return { parts };
  });

  const res = await fetch(`${httpUrl}/agents/${agentName}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`ACP ${res.status}: ${t.slice(0, 200)}`); }
  const data = await res.json();
  const texts = [];
  for (const msg of data.output || []) {
    for (const part of msg.parts || []) {
      if (part.content_type === "text/plain" || !part.content_type) texts.push(part.content);
    }
  }
  return texts.join("\n") || "(empty response)";
}

// ========== 内置 CLI 适配器 ==========

const TMP_DIR = join(tmpdir(), "wechat-cli-agents");

async function callCLI(cliUrl, messages) {
  const name = cliUrl.replace("cli://", "");
  const lastMsg = messages[messages.length - 1];

  // 提取文本和图片
  let prompt = "";
  const imagePaths = [];
  const tmpFiles = [];

  if (typeof lastMsg.content === "string") {
    prompt = lastMsg.content;
  } else if (Array.isArray(lastMsg.content)) {
    await mkdir(TMP_DIR, { recursive: true });
    for (const part of lastMsg.content) {
      if (part.type === "text") prompt += (prompt ? "\n" : "") + part.text;
      else if (part.type === "image_url" && part.image_url?.url) {
        const tmpPath = join(TMP_DIR, `img-${randomBytes(4).toString("hex")}.jpg`);
        const url = part.image_url.url;
        if (url.startsWith("data:")) {
          await writeFile(tmpPath, Buffer.from(url.replace(/^data:[^;]+;base64,/, ""), "base64"));
        } else {
          const r = await fetch(url);
          if (r.ok) await writeFile(tmpPath, Buffer.from(await r.arrayBuffer()));
        }
        imagePaths.push(tmpPath);
        tmpFiles.push(tmpPath);
      }
    }
  }

  if (!prompt && imagePaths.length > 0) prompt = "请描述这张图片";
  if (!prompt) throw new Error("empty prompt");

  try {
    if (name === "codex") return await runCodex(prompt, imagePaths);
    if (name === "gemini") return await runGemini(prompt);
    if (name === "claude") return await runClaude(prompt);
    if (name === "openclaw") return await runOpenClaw(prompt);
    throw new Error(`未知的内置 CLI Agent: ${name}`);
  } finally {
    for (const f of tmpFiles) unlink(f).catch(() => {});
  }
}

function runCodex(prompt, imagePaths = []) {
  return new Promise(async (resolve, reject) => {
    await mkdir(TMP_DIR, { recursive: true });
    const outFile = join(TMP_DIR, `out-${randomBytes(4).toString("hex")}.txt`);
    const args = ["exec", "--skip-git-repo-check", "--ephemeral", "-o", outFile];
    for (const img of imagePaths) args.push("-i", img);
    args.push("--", prompt);

    execFile("codex", args, { timeout: 300_000, maxBuffer: 2 * 1024 * 1024, cwd: tmpdir() },
      async (err, stdout, stderr) => {
        try {
          const reply = await readFile(outFile, "utf-8").catch(() => "");
          await unlink(outFile).catch(() => {});
          if (reply.trim()) resolve(reply.trim());
          else if (stdout.trim()) resolve(stdout.trim());
          else if (err) reject(new Error((stderr || err.message).trim().slice(0, 300)));
          else resolve("(empty response)");
        } catch (e) { reject(e); }
      });
  });
}

function runGemini(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn("gemini", [], { cwd: tmpdir(), stdio: ["pipe", "pipe", "pipe"], timeout: 300_000 });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.stdin.write(prompt);
    child.stdin.end();
    child.on("close", (code) => {
      if (stdout.trim()) resolve(stdout.trim());
      else if (code !== 0) reject(new Error((stderr || `exit code ${code}`).trim().slice(0, 300)));
      else resolve("(empty response)");
    });
    child.on("error", (err) => reject(new Error(`gemini CLI 未安装: ${err.message}`)));
  });
}

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["--print", prompt], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 300_000,
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      if (code !== 0) reject(new Error((stderr + stdout).trim().slice(0, 300) || `exit code ${code}`));
      else resolve(stdout.trim() || "(empty response)");
    });
    child.on("error", (err) => reject(new Error(`claude CLI 未安装: ${err.message}`)));
  });
}

function runOpenClaw(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn("openclaw", [
      "agent", "--agent", "main", "--local",
      "--message", prompt, "--json",
    ], {
      cwd: tmpdir(),
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 300_000,
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error((stderr + stdout).trim().slice(0, 300) || `exit code ${code}`));
        return;
      }
      try {
        const data = JSON.parse(stdout);
        // OpenClaw JSON output: { result: { output: { content: [...] } } }
        const content = data?.result?.output?.content;
        if (Array.isArray(content)) {
          const texts = content
            .filter(b => b.type === "text")
            .map(b => b.text);
          if (texts.length) { resolve(texts.join("\n")); return; }
        }
        // fallback: try common fields
        resolve((data.reply || data.text || data.content || stdout).trim() || "(empty response)");
      } catch {
        resolve(stdout.trim() || "(empty response)");
      }
    });
    child.on("error", (err) => reject(new Error(`openclaw CLI 未安装: ${err.message}`)));
  });
}
