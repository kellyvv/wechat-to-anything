# wechat-to-anything

> 把微信变成任何 AI Agent 的前端。

微信发消息 → Agent 回复。就这么简单。

## 原理

```
微信 ←→ 腾讯 ClawBot ←→ wechat-to-anything ←→ 你的 Agent (HTTP)
```

基于[腾讯官方微信 ClawBot](https://github.com/nicepkg/openclaw-weixin) 实现微信接入。你的 Agent 只需暴露一个 OpenAI 兼容的 HTTP 接口（`POST /v1/chat/completions`），任何语言都行。

## 前置条件

- Node.js >= 22（`nvm install 22`）

## 快速开始（以 Claude Code 为例）

**1. 启动 Agent**

```bash
cd examples/claude-code
npm install
node server.mjs
# Agent 运行在 http://localhost:3000/v1
```

> 需要先登录 Claude Code（`claude /login`）或设置 `ANTHROPIC_API_KEY` 环境变量。

**2. 连接微信**

```bash
npx wechat-to-anything http://localhost:3000/v1
```

扫码 → 完成。在微信里发消息，Claude Code 回复。

## 接入你自己的 Agent

任何语言，暴露 `POST /v1/chat/completions` 即可：

```python
@app.post("/v1/chat/completions")
def chat(request):
    message = request.json["messages"][-1]["content"]
    reply = your_agent(message)
    return {"choices": [{"message": {"role": "assistant", "content": reply}}]}
```

然后 `npx wechat-to-anything http://your-agent:8000/v1`。

## License

[MIT](LICENSE)
