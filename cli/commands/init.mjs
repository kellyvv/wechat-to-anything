import * as p from "@clack/prompts";
import pc from "picocolors";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

export default async function init({ root }) {
  console.log();
  p.intro(pc.bgCyan(pc.black(" 🌉 wechat-to-anything ")));

  // 只需要一个 API Key
  const apiKey = await p.text({
    message: "输入你的 Anthropic API Key",
    placeholder: "sk-ant-...",
    validate: (v) => {
      if (!v || v.trim().length === 0) return "API Key 不能为空";
    },
  });

  if (p.isCancel(apiKey)) {
    p.cancel("已取消");
    process.exit(0);
  }

  // 自动生成配置
  const s = p.spinner();
  s.start("正在生成配置...");

  const outDir = resolve(root, ".wechat-to-anything");
  await mkdir(outDir, { recursive: true });

  // .env
  await writeFile(
    resolve(outDir, ".env"),
    `ANTHROPIC_API_KEY=${apiKey.trim()}\n`
  );

  // openclaw 配置
  await writeFile(
    resolve(outDir, "openclaw.config.yaml"),
    `# 由 wechat-to-anything 自动生成
providers:
  default:
    baseUrl: "https://api.anthropic.com"
    api: "anthropic"
    model: "claude-sonnet-4-20250514"
    apiKey: "\${ANTHROPIC_API_KEY}"

plugins:
  - "@anthropic-ai/claude-code"
`
  );

  s.stop("配置已生成 ✅");

  p.note(
    [
      `配置目录: ${pc.dim(outDir)}`,
      "",
      pc.cyan("接下来:"),
      "",
      `  ${pc.green("1.")} npm install -g openclaw`,
      `  ${pc.green("2.")} openclaw gateway run`,
      `  ${pc.green("3.")} 微信扫码 → 搞定 🎉`,
    ].join("\n"),
    "下一步"
  );

  p.outro(pc.green("完成！"));
}
