# wechat-to-anything

> 一条命令，把微信变成任何 AI Agent 的入口。以 Claude Code 为例。

## 原理

```
微信 ←→ 腾讯 ClawBot ←→ wechat-to-anything (网关) ←→ 你的 Agent (HTTP)
```

基于[腾讯官方微信 ClawBot](https://github.com/nicepkg/openclaw-weixin) 实现微信连接，你的 Agent 只需暴露一个 OpenAI 兼容的 HTTP 接口。

## 快速开始

### 1. 启动你的 Agent

以 Claude Code 为例（见 `examples/claude-code/`）：

```bash
cd examples/claude-code
npm install
ANTHROPIC_API_KEY=sk-ant-xxx npm start
# Agent 运行在 http://localhost:3000/v1
```

### 2. 启动桥

```bash
npx wechat-to-anything http://localhost:3000/v1
```

微信扫码 → 完成。在微信里发消息，Agent 回复。

## 接入你自己的 Agent

任何语言、任何框架，只要暴露 `POST /v1/chat/completions`：

```python
# Python 示例
@app.post("/v1/chat/completions")
def chat(request):
    message = request.json["messages"][-1]["content"]
    reply = your_agent(message)
    return {"choices": [{"message": {"role": "assistant", "content": reply}}]}
```

```bash
npx wechat-to-anything http://localhost:8000/v1
```

就这么简单。

## License

[MIT](LICENSE)
