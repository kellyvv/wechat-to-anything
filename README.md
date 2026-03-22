# wechat-to-anything

> 一条命令，把微信连上 Claude Code

## 用法

```bash
npx wechat-to-anything
```

填入 Anthropic API Key → 扫码 → 完成。

## 原理

```
微信 ←→ OpenClaw Gateway ←→ Claude Code
```

自动配置 [OpenClaw](https://openclaw.ai) + [微信 ClawBot](https://github.com/nicepkg/openclaw-weixin)，你只需要一个 API Key。

## License

[MIT](LICENSE)
