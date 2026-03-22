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
  ${pc.green("单 Agent:")}
  npx wechat-to-anything ${pc.green("<agent-url>")}

  ${pc.green("多 Agent:")}
  npx wechat-to-anything ${pc.green("--agent codex=http://localhost:3001/v1 --agent gemini=http://localhost:3002/v1 --default codex")}

${pc.bold("参数:")}
  --agent ${pc.dim("name=url")}    注册一个 Agent（可多次使用）
  --default ${pc.dim("name")}      设置默认 Agent

${pc.bold("示例:")}
  npx wechat-to-anything http://localhost:3000/v1
  npx wechat-to-anything --agent codex=http://localhost:3001/v1 --agent gemini=http://localhost:3002/v1

${pc.bold("微信消息路由:")}
  发 ${pc.green("@codex 写个排序")} → 路由到 Codex Agent
  发 ${pc.green("@gemini 审查代码")} → 路由到 Gemini Agent
  发 ${pc.green("@list")}          → 查看可用 Agent 列表
  发 ${pc.green("@切换 gemini")}   → 切换默认 Agent

${pc.dim("Docs: https://github.com/kellyvv/wechat-to-anything")}
`);
  process.exit(args.length > 0 ? 0 : 1);
}

// 解析参数
let i = 0;
while (i < args.length) {
  if (args[i] === "--agent" && args[i + 1]) {
    const [name, ...urlParts] = args[i + 1].split("=");
    const url = urlParts.join("=");
    if (!name || !url) {
      console.error(pc.red(`无效的 --agent 参数: ${args[i + 1]}，格式: name=url`));
      process.exit(1);
    }
    // acp:// 或 http(s):// 都接受
    if (!url.startsWith("acp://")) {
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
  } else if (!args[i].startsWith("--")) {
    // 向后兼容：裸 URL 参数当作单 Agent
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

import("../cli/bridge.mjs").then((mod) => mod.start(agents, defaultAgent)).catch((err) => {
  console.error(pc.red(err.message));
  process.exit(1);
});
