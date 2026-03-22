# wechat-to-anything

> 把微信变成任何 AI Agent 的前端。零依赖，一条命令。
>
> ⭐ 如果这个项目对你有帮助，请给个 Star！本项目仅用于技术学习和交流，开源不易。

微信双向支持 Agent 多种模态消息发送和接收，支持文本、图片、语音、文件。

<p align="center">
  <img src="docs/wechat-image-send.png" width="250" alt="发送图片给 Agent 识别" />
  <img src="docs/wechat-image-receive.png" width="250" alt="Agent 发送图片到微信" />
  <a href="https://github.com/kellyvv/wechat-to-anything/raw/main/docs/wechat-voice-demo.mp4">
    <img src="docs/wechat-voice-demo.gif" width="250" alt="语音发送演示（点击播放有声版）" />
  </a>
</p>

## 原理

```
微信 ←→ ilinkai API (腾讯) ←→ wechat-to-anything ←→ 你的 Agent (HTTP)
```

直接调用腾讯 ilinkai 接口收发微信消息，无中间层。你的 Agent 只需暴露一个 OpenAI 兼容的 HTTP 接口（`POST /v1/chat/completions`），任何语言都行。

### 多种模态支持

| 方向 | 图片 | 语音 | 文件 |
|---|---|---|---|
| **微信 → Agent** | ✅ 自动识别 | ✅ 语音转文字 | ✅ 提取文本 |
| **Agent → 微信** | ✅ 自动发图 | ✅ 语音消息 | 文本回复 |

## 前置条件

- Node.js >= 22（`nvm install 22`）

## 快速开始

```bash
# 一条命令，选你喜欢的 Agent：
npx wechat-to-anything --codex     # OpenAI Codex
npx wechat-to-anything --gemini    # Google Gemini
npx wechat-to-anything --claude    # Claude Code
npx wechat-to-anything --openclaw  # OpenClaw

# 多 Agent 同时用：
npx wechat-to-anything --codex --gemini
```

> 需要先安装对应 CLI：`npm i -g @openai/codex` / `@google/gemini-cli` / `@anthropic-ai/claude-code` / `openclaw`
>
> 也支持直接传 URL：`npx wechat-to-anything http://your-agent:8000/v1`

### 接入 OpenClaw

```bash
# 1. 安装并配置 OpenClaw
npm i -g openclaw
openclaw configure         # 设置模型（如 Gemini / OpenAI）

# 2. 启动 Gateway
openclaw gateway

# 3. 启动桥（另一个终端）
npx wechat-to-anything --openclaw
```

> OpenClaw 的 Gateway 需要先配好模型 provider（运行 `openclaw configure`）。
> 如果 OpenClaw 已有 `openclaw-weixin` 插件，需先禁用以避免消息冲突。

### 首次使用

终端会弹出二维码 → 微信扫码 → 完成。之后自动复用登录凭证。

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

## 多 Agent 模式

同时接入多个 Agent，通过 `@` 前缀路由消息。支持 OpenAI 兼容格式和 [ACP (Agent Communication Protocol)](https://agentcommunicationprotocol.dev/) 两种协议：

```bash
npx wechat-to-anything \
  --agent codex=http://localhost:3001/v1 \
  --agent gemini=http://localhost:3002/v1 \
  --agent bee=acp://localhost:8000/chat \
  --default codex
```

> `http://` → OpenAI 格式，`acp://` → ACP 协议，自动识别。

微信里使用：

| 消息 | 效果 |
|---|---|
| `你好` | 发给默认 Agent |
| `@codex 写个排序` | 路由到 Codex |
| `@gemini 审查代码` | 路由到 Gemini |
| `@bee 分析数据` | 路由到 ACP Agent |
| `@list` | 查看已注册的 Agent |
| `@切换 gemini` | 切换默认 Agent |

多 Agent 模式下回复自动带 `[agentName]` 前缀标识来源。每个用户独立维护默认 Agent。

**图片支持**：消息格式遵循 [OpenAI Vision API](https://platform.openai.com/docs/guides/vision)，`content` 为数组：

```json
{
  "messages": [{
    "role": "user",
    "content": [
      { "type": "text", "text": "这是什么？" },
      { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,..." } }
    ]
  }]
}
```

**图片回复**：Agent 回复中包含 markdown 图片 `![desc](https://...)` 会自动作为图片消息发到微信。

**语音回复**：Agent 回复中包含 `[audio:/path/to/file.mp3]`，桥会自动转为微信语音消息。支持 MP3、WAV、OGG 等格式。
## 凭证

登录凭证保存在 `~/.wechat-to-anything/credentials.json`，删除即可重新登录。



## Star History

如果这个项目帮到了你，请给个 ⭐ Star，这是对我们最大的支持！

## License

[MIT](LICENSE)
