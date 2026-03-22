# wechat-to-anything

> 把微信变成任何 AI Agent 的前端。零依赖，一条命令。
>
> ⭐ 如果这个项目对你有帮助，请给个 Star！所有接口都是逆向试出来的，开源不易。

微信双向支持 Agent 多种模态消息发送和接收，支持文本、图片、语音、文件。

<p align="center">
  <img src="docs/wechat-image-send.png" width="300" alt="发送图片给 Agent 识别" />
  <img src="docs/wechat-image-receive.png" width="300" alt="Agent 发送图片到微信" />
</p>

## 原理

```
微信 ←→ ilinkai API (腾讯) ←→ wechat-to-anything ←→ 你的 Agent (HTTP)
```

直接调用腾讯 ilinkai 接口收发微信消息，无中间层。你的 Agent 只需暴露一个 OpenAI 兼容的 HTTP 接口（`POST /v1/chat/completions`），任何语言都行。

### 多媒体支持

| 方向 | 图片 | 语音 | 文件 |
|---|---|---|---|
| **微信 → Agent** | CDN 下载解密 → base64 多模态 | 微信自动语音转文字 | 下载并提取文本内容 |
| **Agent → 微信** | 回复含图片 URL 自动发图 | TTS → SILK → CDN 语音消息 | 文本回复 |

**图片**：用户先发图片（桥缓存），再发文字问题 → 多模态消息。Agent 回复含 `![](url)` → 自动发图。

**语音**：发送 "语音测试" 可触发 TTS 语音发送（Edge TTS → SILK → 微信 CDN → 语音气泡）。

## 前置条件

- Node.js >= 22（`nvm install 22`）

## 快速开始

### 方式一：Claude Code

```bash
# 1. 启动 Agent
cd examples/claude-code
npm install
node server.mjs

# 2. 连接微信（另一个终端）
npx wechat-to-anything http://localhost:3000/v1
```

> 需要先登录 Claude Code（`claude /login`）或设置 `ANTHROPIC_API_KEY`。

### 方式二：OpenAI Codex

```bash
# 1. 安装并登录 Codex
npm install -g @openai/codex
codex login

# 2. 启动 Agent
cd examples/openai
node server.mjs

# 3. 连接微信（另一个终端）
npx wechat-to-anything http://localhost:3001/v1
```

> 使用 Codex CLI 账号登录（Plus 订阅），不需要 API key。支持图片识别（gpt-5.4）。

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

## 项目结构

```
wechat-to-anything/
├── bin/cli.mjs            # CLI 入口
├── cli/
│   ├── weixin.mjs         # 微信 ilinkai API（登录/收发消息）
│   ├── bridge.mjs         # 桥：微信 ←→ Agent（多媒体处理）
│   └── cdn.mjs            # CDN 加解密（下载图片/语音/文件）
├── examples/
│   ├── claude-code/       # Claude Code Agent 示例
│   └── openai/            # OpenAI Codex Agent 示例（支持图片）
└── package.json
```

## 凭证

登录凭证保存在 `~/.wechat-to-anything/credentials.json`，删除即可重新登录。

## 逆向工程备注

本项目的微信接口全部通过逆向工程试出，没有任何官方文档。以下是关键发现：

| CDN `mediaType` | 类型 | 说明 |
|---|---|---|
| 1 | IMAGE | 图片上传 |
| 2 | VIDEO | 视频上传 |
| 3 | FILE | 文件上传 |
| **4** | **VOICE** | **语音上传（唯一能正常播放的类型）** |
| 5-20 | — | 不支持 |

- CDN 上传后的下载引用需使用 `x-encrypted-query-param` 响应头（非 `x-encrypted-param`）
- 语音格式：SILK v3（Tencent 前缀 `0x02`），16kHz 采样率
- `voice_item` 字段：`playtime`（非 `voice_length`）、`encode_type: 4`、`sample_rate: 16000`
- `aes_key` 编码：`base64(hex_string)`，CDN 使用 AES-128-ECB 加密

> 这些接口随时可能变化。如果发现问题，欢迎提 issue。

## Star History

如果这个项目帮到了你，请给个 ⭐ Star，这是对我们最大的支持！

## License

[MIT](LICENSE)
