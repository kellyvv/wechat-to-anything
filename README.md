# wechat-to-anything

> 把微信变成任何 AI Agent 的前端。零依赖，一条命令。

微信发消息 → Agent 回复。文本、图片、语音、文件全支持。

## 原理

```
微信 ←→ ilinkai API (腾讯) ←→ wechat-to-anything ←→ 你的 Agent (HTTP)
```

直接调用腾讯 ilinkai 接口收发微信消息，无中间层。你的 Agent 只需暴露一个 OpenAI 兼容的 HTTP 接口（`POST /v1/chat/completions`），任何语言都行。

### 多媒体支持

| 方向 | 图片 | 语音 | 文件 |
|---|---|---|---|
| **微信 → Agent** | base64 多模态发送，Agent 能"看到" | 微信自动语音转文字 | 下载并提取文本内容 |
| **Agent → 微信** | 回复含图片URL自动发图 | 文本回复 | 文本回复 |

## 前置条件

- Node.js >= 22（`nvm install 22`）

## 快速开始（以 Claude Code 为例）

**1. 启动 Agent**

```bash
cd examples/claude-code
npm install
node server.mjs
```

> 需要先登录 Claude Code（`claude /login`）或设置 `ANTHROPIC_API_KEY`。

**2. 连接微信**

```bash
npx wechat-to-anything http://localhost:3000/v1
```

首次使用会自动弹出二维码 → 微信扫码 → 完成。

之后每次启动直接复用登录凭证，无需重新扫码。

## 接入你自己的 Agent

暴露 `POST /v1/chat/completions` 即可，任何语言：

```python
@app.post("/v1/chat/completions")
def chat(request):
    message = request.json["messages"][-1]["content"]
    reply = your_agent(message)
    return {"choices": [{"message": {"role": "assistant", "content": reply}}]}
```

然后 `npx wechat-to-anything http://your-agent:8000/v1`。

**图片支持**：如果 Agent 需要处理图片，消息格式遵循 [OpenAI Vision API](https://platform.openai.com/docs/guides/vision)，`content` 为数组，包含 `text` 和 `image_url`（base64）。

## 凭证

登录凭证保存在 `~/.wechat-to-anything/credentials.json`，删除即可重新登录。

## License

[MIT](LICENSE)
