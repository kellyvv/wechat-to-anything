#!/usr/bin/env node

const [, , command] = process.argv;

// 默认就是 init，其他命令暂不开放
if (command === "help" || command === "--help" || command === "-h") {
  console.log(`
🌉 wechat-to-anything

Usage:
  npx wechat-to-anything       交互式配置（默认）

Docs: https://github.com/kellyvv/wechat-to-anything
`);
  process.exit(0);
}

if (command && command !== "init") {
  console.error(`未知命令: ${command}`);
  console.log("直接运行 npx wechat-to-anything 即可");
  process.exit(1);
}

import("../cli/commands/init.mjs").then((mod) =>
  mod.default({ root: process.cwd() })
).catch((err) => {
  console.error(err);
  process.exit(1);
});
