#!/usr/bin/env node

import pc from "picocolors";

// 解析命令行参数
const args = process.argv.slice(2);
const agents = new Map();
let defaultAgent = null;

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  console.log(`
${pc.cyan("🌉 wechat-to-anything")}

${pc.dim("一条命令，把微信变成任何 AI Agent 的入口")}

${pc.bold("用法:")}
  ${pc.green("最简单:")}
  npx wechat-to-anything ${pc.green("--codex")}
  npx wechat-to-anything ${pc.green("--gemini")}
  npx wechat-to-anything ${pc.green("--claude")}
  npx wechat-to-anything ${pc.green("--openclaw")}
  npx wechat-to-anything ${pc.green("--codex --gemini --claude")}    ${pc.dim("多 Agent")}

  ${pc.green("自定义 Agent:")}
  npx wechat-to-anything ${pc.green("<agent-url>")}
  npx wechat-to-anything ${pc.green("--agent name=url --agent name2=url2")}

${pc.bold("参数:")}
  --codex               ${pc.dim("内置 Codex CLI（需先 npm i -g @openai/codex）")}
  --gemini              ${pc.dim("内置 Gemini CLI（需先 npm i -g @google/gemini-cli）")}
  --claude              ${pc.dim("内置 Claude Code CLI（需先 npm i -g @anthropic-ai/claude-code）")}
  --openclaw            ${pc.dim("内置 OpenClaw（需先 npm i -g openclaw）")}
  --agent ${pc.dim("name=url")}    ${pc.dim("注册自定义 Agent")}
  --default ${pc.dim("name")}      ${pc.dim("设置默认 Agent")}
  --port ${pc.dim("PORT")}        ${pc.dim("API 端口（默认 9099），暴露 POST /api/send")}

${pc.bold("API:")}
  POST http://localhost:PORT/api/send
  ${pc.dim('{ "to": "user_id", "content": "消息内容" }')}
  ${pc.dim("Agent 可主动推送多条消息，模拟真人节奏")}

${pc.dim("Docs: https://github.com/kellyvv/wechat-to-anything")}
`);
  process.exit(args.length > 0 ? 0 : 1);
}

// 解析参数
let i = 0;
let port = 9099;
while (i < args.length) {
  if (args[i] === "--codex") {
    agents.set("codex", "cli://codex");
    i++;
  } else if (args[i] === "--gemini") {
    agents.set("gemini", "cli://gemini");
    i++;
  } else if (args[i] === "--claude") {
    agents.set("claude", "cli://claude");
    i++;
  } else if (args[i] === "--openclaw") {
    agents.set("openclaw", "cli://openclaw");
    i++;
  } else if (args[i] === "--agent" && args[i + 1]) {
    const [name, ...urlParts] = args[i + 1].split("=");
    const url = urlParts.join("=");
    if (!name || !url) {
      console.error(pc.red(`无效的 --agent 参数: ${args[i + 1]}，格式: name=url`));
      process.exit(1);
    }
    if (!url.startsWith("acp://") && !url.startsWith("cli://")) {
      try { new URL(url); } catch {
        console.error(pc.red(`无效的 Agent URL: ${url}`));
        process.exit(1);
      }
    }
    agents.set(name.toLowerCase(), url);
    i += 2;
  } else if (args[i] === "--default" && args[i + 1]) {
    defaultAgent = args[i + 1].toLowerCase();
    i += 2;
  } else if (args[i] === "--port" && args[i + 1]) {
    port = parseInt(args[i + 1], 10);
    if (isNaN(port)) {
      console.error(pc.red(`无效的端口号: ${args[i + 1]}`));
      process.exit(1);
    }
    i += 2;
  } else if (!args[i].startsWith("--")) {
    if (!args[i].startsWith("acp://")) {
      try { new URL(args[i]); } catch {
        console.error(pc.red(`无效的 URL: ${args[i]}`));
        process.exit(1);
      }
    }
    agents.set("default", args[i]);
    defaultAgent = "default";
    i++;
  } else {
    console.error(pc.red(`未知参数: ${args[i]}`));
    process.exit(1);
  }
}

if (agents.size === 0) {
  console.error(pc.red("至少需要一个 Agent，用 --agent name=url 或直接传 URL"));
  process.exit(1);
}

// 默认用第一个注册的 Agent
if (!defaultAgent) {
  defaultAgent = agents.keys().next().value;
}

if (!agents.has(defaultAgent)) {
  console.error(pc.red(`默认 Agent "${defaultAgent}" 未注册`));
  process.exit(1);
}

console.log();
console.log(pc.cyan("🌉 wechat-to-anything"));
if (agents.size === 1 && agents.has("default")) {
  console.log(pc.dim(`   Agent: ${agents.get("default")}`));
} else {
  for (const [name, url] of agents) {
    const isDefault = name === defaultAgent;
    console.log(pc.dim(`   ${isDefault ? "★" : " "} ${name}: ${url}`));
  }
}
console.log();

import("../cli/bridge.mjs").then((mod) => mod.start(agents, defaultAgent, { port })).catch((err) => {
  console.error(pc.red(err.message));
  process.exit(1);
});
