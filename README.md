<p align="center">
  <img src="docs/banner.png" alt="weiclaw" />
</p>

<h1 align="center">weiclaw</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/weiclaw"><img src="https://img.shields.io/npm/v/weiclaw?style=flat-square&color=cb3837" alt="npm" /></a>
  <a href="https://github.com/kellyvv/weiclaw"><img src="https://img.shields.io/github/stars/kellyvv/weiclaw?style=flat-square&color=yellow" alt="stars" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/kellyvv/weiclaw?style=flat-square" alt="license" /></a>
  <a href="https://github.com/kellyvv/weiclaw"><img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen?style=flat-square" alt="node" /></a>
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> · <a href="#全模态支持矩阵">全模态</a> · <a href="#多媒体协议">多媒体协议</a> · <a href="#多-agent-模式">多 Agent</a> · <a href="#主动发送-api">主动发送</a> · <a href="#接入自己的-agent">自定义 Agent</a>
</p>

<p align="center">
  中文 | <a href="README.en.md">English</a>
</p>

> ⭐ 如果这个项目对你有帮助，请给个 Star！

**全网首个**支持微信与任何 AI Agent 全模态双向通信的开源项目 —— 文本、图片、语音、视频、文件，发送和接收全覆盖。

<p align="center">
  <img src="docs/wechat-image-send.png" width="250" alt="Agent 发送文件、图片、语音" />
  <img src="docs/wechat-image-receive.png" width="250" alt="Agent 发送图片、视频、语音" />
  <a href="https://github.com/kellyvv/weiclaw/raw/main/docs/wechat-voice-demo.mp4">
    <img src="docs/wechat-voice-demo.gif" width="250" alt="语音演示（点击播放有声版）" />
  </a>
</p>

## 特性

- 🔌 **零依赖接入** — `npx` 一条命令，无需 clone、无需配置
- 🧠 **Agent 无关** — 支持任何 OpenAI 兼容 API（Codex / Gemini / Claude / OpenCode / 自建）
- 📡 **全模态** — 文本、图片、语音、视频、文件，双向全覆盖
- 🤖 **多 Agent** — 同时接入多个 Agent，`@` 路由切换
- ⌨️ **打字指示器** — Agent 思考时显示"对方正在输入"
- 📤 **主动发送 API** — Agent 可推送多条消息，模拟真人打字节奏

### 全模态支持矩阵

| 模态 | 微信 → Agent | Agent → 微信 |
|------|:---:|:---:|
| 📝 文本 | ✅ | ✅ |
| 📷 图片 | ✅ 自动识别 | ✅ HD 原图 |
| 🎤 语音 | ✅ 语音转文字 | ✅ 语音气泡 |
| 🎬 视频 | ✅ 自动接收 | ✅ 带缩略图 |
| 📄 文件 | ✅ 提取内容 | ✅ 可下载 |
| 💬 引用消息 | ✅ 自动提取引用媒体 | — |

### 已支持的 Agent / 工具

| Agent | 接入方式 | 安装 |
|-------|---------|------|
| ⌬ [OpenCode](https://opencode.ai) | `examples/opencode/` 模板 | `npm i -g opencode-ai` |
| 🤖 [OpenAI Codex](https://github.com/openai/codex) | `--codex` | `npm i -g @openai/codex` |
| 💎 [Google Gemini](https://github.com/google/gemini-cli) | `--gemini` | `npm i -g @google/gemini-cli` |
| 🧬 [Claude Code](https://github.com/anthropic-ai/claude-code) | `--claude` | `npm i -g @anthropic-ai/claude-code` |
| 🐾 [OpenClaw](https://github.com/nicepkg/openclaw) | `--openclaw` | `npm i -g openclaw` |
| 🔗 任何 OpenAI 兼容 API | 直接传 URL | — |
| 📡 [ACP 协议](https://agentcommunicationprotocol.dev/) Agent | `--agent name=acp://...` | — |

> **首次使用各 CLI Agent 前需完成认证：**
> - **Claude**：`claude` 登录你的 Anthropic 账号
> - **Gemini**：运行一次 `gemini`，浏览器弹出 Google OAuth 授权，完成后 token 会缓存到本地，之后 `--gemini` 模式即可正常使用
> - **Codex**：运行一次 `codex`，完成 OpenAI OAuth 授权

## 快速开始

```bash
# 选你喜欢的 Agent：
npx weiclaw --codex     # OpenAI Codex
npx weiclaw --gemini    # Google Gemini
npx weiclaw --claude    # Claude Code
npx weiclaw --openclaw  # OpenClaw

# 或用 examples 模板接入更多 Agent：
cd examples/opencode && node server.mjs  # OpenCode（含免费模型）

# 或直接传 URL：
npx weiclaw http://your-agent:8000/v1
```

> 首次使用：终端弹出二维码 → 微信扫码 → 完成。之后自动复用登录。

### 环境依赖

```bash
# 1. Node.js >= 22
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
nvm install 22

# 2. Python 3 + pip
brew install python3       # macOS
apt install python3 python3-pip  # Linux

# 3. ffmpeg
brew install ffmpeg        # macOS
apt install ffmpeg         # Linux

# 4. pilk
pip install pilk
```

## 原理

```
微信用户 ←→ 腾讯 ilinkai API ←→ weiclaw ←→ 你的 Agent (HTTP)
```

直接调用腾讯 ilinkai 接口收发微信消息，无中间层、无逆向、无网页版。Agent 只需暴露一个 OpenAI 兼容的 HTTP 接口。

## 接入自己的 Agent

任何语言，暴露 `POST /v1/chat/completions` 即可：

```python
@app.post("/v1/chat/completions")
def chat(request):
    message = request.json["messages"][-1]["content"]
    reply = your_agent(message)
    return {"choices": [{"message": {"role": "assistant", "content": reply}}]}
```

然后：`npx weiclaw http://your-agent:8000/v1`

## 多媒体协议

Agent 回复中包含特定格式即可自动发送多媒体：

| 类型 | Agent 回复格式 | 说明 |
|------|--------------|------|
| 图片 | `![描述](URL或路径)` | 支持 URL、本地路径、data URI |
| 语音 | `[audio:路径或URL]` | MP3/WAV/OGG，需 `ffmpeg` + `pilk` |
| 视频 | `[video:路径或URL]` | 需 `ffmpeg` |
| 文件 | `[file:路径或URL]` | 任意文件类型 |

**图片接收**（微信 → Agent）遵循 [OpenAI Vision API](https://platform.openai.com/docs/guides/vision)：

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

> 示例：[image-test.mjs](examples/image-test.mjs) · [voice-test.mjs](examples/voice-test.mjs) · [video-test-local.mjs](examples/video-test-local.mjs) · [file-test.mjs](examples/file-test.mjs)
>
> Agent 模板：[claude-code](examples/claude-code/) · [opencode](examples/opencode/) · [openai](examples/openai/)

## 多 Agent 模式

同时接入多个 Agent，`@` 前缀路由。支持 OpenAI 格式和 [ACP 协议](https://agentcommunicationprotocol.dev/)：

```bash
npx weiclaw \
  --agent codex=http://localhost:3001/v1 \
  --agent gemini=http://localhost:3002/v1 \
  --agent bee=acp://localhost:8000/chat \
  --default codex
```

| 微信消息 | 效果 |
|---|---|
| `你好` | 发给默认 Agent |
| `@codex 写个排序` | 路由到 Codex |
| `@gemini 审查代码` | 路由到 Gemini |
| `@list` | 查看所有 Agent |
| `@切换 gemini` | 切换默认 |

## 主动发送 API

Bridge 启动时会在 `localhost:9099` 暴露 HTTP API，Agent 可主动推送多条消息（模拟真人打字节奏）：

```bash
curl -X POST http://localhost:9099/api/send \
  -H "Content-Type: application/json" \
  -d '{"to": "user_id", "content": "嗯……"}'
```

- `to` — 微信用户 ID（bridge 调 agent 时通过 `user` 字段传入）
- `content` — 支持和 Agent 回复相同的格式（纯文本、`![](url)`、`[audio:path]` 等）
- 用 `--port PORT` 自定义端口

**用途**：Agent 对一条消息可分多段回复，控制发送间隔：

```python
import requests, time
def send(to, text):
    requests.post("http://localhost:9099/api/send", json={"to": to, "content": text})

send(user_id, "嗯……")
time.sleep(1.5)
send(user_id, "让我想想")
time.sleep(2)
# 最后一段作为正常 response 返回
```

## 凭证

登录凭证保存在 `~/.weiclaw/credentials.json`，删除即可重新登录。

## Star History

如果这个项目帮到了你，请给个 ⭐ Star，这是对我们最大的支持！

## License

[MIT](LICENSE)
