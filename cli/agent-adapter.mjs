/**
 * Agent 调用适配器
 * 
 * 根据 URL scheme 自动选择协议：
 * - http:// / https:// → OpenAI 兼容格式
 * - acp://             → ACP (Agent Communication Protocol)
 */

/**
 * 统一调用接口 — 根据 URL 自动选择适配器
 * @param {string} url - Agent URL（http:// 或 acp://）
 * @param {Array} messages - OpenAI 格式的 messages 数组
 * @returns {Promise<string>} Agent 回复文本
 */
export async function callAgentAuto(url, messages) {
  if (url.startsWith("acp://")) {
    return callACP(url, messages);
  }
  return callOpenAI(url, messages);
}

/**
 * 解析 ACP URL → { httpUrl, agentName }
 * acp://localhost:8000/chat → { httpUrl: "http://localhost:8000", agentName: "chat" }
 */
function parseACPUrl(acpUrl) {
  const withoutScheme = acpUrl.replace(/^acp:\/\//, "");
  const slashIdx = withoutScheme.indexOf("/");
  if (slashIdx === -1) {
    throw new Error(`无效的 ACP URL: ${acpUrl}，格式: acp://host:port/agentName`);
  }
  const host = withoutScheme.slice(0, slashIdx);
  const agentName = withoutScheme.slice(slashIdx + 1);
  return { httpUrl: `http://${host}`, agentName };
}

/**
 * 验证 Agent URL 是否可达
 */
export async function checkAgent(url) {
  if (url.startsWith("acp://")) {
    const { httpUrl } = parseACPUrl(url);
    const res = await fetch(`${httpUrl}/agents`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`ACP server 不可达: ${res.status}`);
    return;
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

async function callACP(acpUrl, messages) {
  const { httpUrl, agentName } = parseACPUrl(acpUrl);

  // 转换 OpenAI messages → ACP input
  const input = messages.map((msg) => {
    if (typeof msg.content === "string") {
      return {
        parts: [{ content: msg.content, content_type: "text/plain" }],
      };
    }
    // 多模态消息（图片+文字）
    const parts = [];
    for (const item of msg.content) {
      if (item.type === "text") {
        parts.push({ content: item.text, content_type: "text/plain" });
      } else if (item.type === "image_url") {
        parts.push({ content: item.image_url.url, content_type: "image/jpeg" });
      }
    }
    return { parts };
  });

  const res = await fetch(`${httpUrl}/agents/${agentName}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
    signal: AbortSignal.timeout(300_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ACP ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();

  // 提取 ACP 输出 → 纯文本
  const output = data.output || [];
  const texts = [];
  for (const msg of output) {
    for (const part of msg.parts || []) {
      if (part.content_type === "text/plain" || !part.content_type) {
        texts.push(part.content);
      }
    }
  }
  return texts.join("\n") || "(empty response)";
}
