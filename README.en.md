<p align="center">
  <img src="docs/banner.png" alt="wechat-to-anything" />
</p>

<h1 align="center">wechat-to-anything</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/wechat-to-anything"><img src="https://img.shields.io/npm/v/wechat-to-anything?style=flat-square&color=cb3837" alt="npm" /></a>
  <a href="https://github.com/kellyvv/wechat-to-anything"><img src="https://img.shields.io/github/stars/kellyvv/wechat-to-anything?style=flat-square&color=yellow" alt="stars" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/kellyvv/wechat-to-anything?style=flat-square" alt="license" /></a>
  <a href="https://github.com/kellyvv/wechat-to-anything"><img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen?style=flat-square" alt="node" /></a>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> · <a href="#full-multimodal-matrix">Multimodal</a> · <a href="#media-protocol">Media Protocol</a> · <a href="#multi-agent-mode">Multi-Agent</a> · <a href="#bring-your-own-agent">Custom Agent</a>
</p>

<p align="center">
  <a href="README.md">中文</a> | English
</p>

> ⭐ If this project helps you, please give it a Star!

**The first open-source project** to support full multimodal bidirectional communication between WeChat and AI Agents — text, images, voice, video, and files, both sending and receiving.

<p align="center">
  <img src="docs/wechat-image-send.png" width="250" alt="Agent sends files, images, voice" />
  <img src="docs/wechat-image-receive.png" width="250" alt="Agent sends images, video, voice" />
  <a href="https://github.com/kellyvv/wechat-to-anything/raw/main/docs/wechat-voice-demo.mp4">
    <img src="docs/wechat-voice-demo.gif" width="250" alt="Voice demo (click for audio)" />
  </a>
</p>

## Features

- 🔌 **Zero-config setup** — One `npx` command, no cloning, no configuration
- 🧠 **Agent-agnostic** — Works with any OpenAI-compatible API (Codex / Gemini / Claude / custom)
- 📡 **Full multimodal** — Text, images, voice, video, files — bidirectional
- 🤖 **Multi-Agent** — Connect multiple Agents simultaneously, route with `@` prefix
- ⌨️ **Typing indicator** — Shows "typing..." while Agent is thinking

### Full Multimodal Matrix

| Modality | WeChat → Agent | Agent → WeChat |
|------|:---:|:---:|
| 📝 Text | ✅ | ✅ |
| 📷 Image | ✅ Auto-detect | ✅ HD original |
| 🎤 Voice | ✅ Speech-to-text | ✅ Voice bubble |
| 🎬 Video | ✅ Auto-receive | ✅ With thumbnail |
| 📄 File | ✅ Content extraction | ✅ Downloadable |

## Quick Start

```bash
# Pick your favorite Agent:
npx wechat-to-anything --codex     # OpenAI Codex
npx wechat-to-anything --gemini    # Google Gemini
npx wechat-to-anything --claude    # Claude Code
npx wechat-to-anything --openclaw  # OpenClaw

# Or pass a URL directly:
npx wechat-to-anything http://your-agent:8000/v1
```

> First time: A QR code pops up in terminal → Scan with WeChat → Done. Login is cached automatically.

### Dependencies

```bash
# 1. Node.js >= 22
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
nvm install 22

# 2. Python 3 + pip
brew install python3       # macOS
apt install python3 python3-pip  # Linux

# 3. ffmpeg (voice / video sending)
brew install ffmpeg        # macOS
apt install ffmpeg         # Linux

# 4. pilk (voice SILK encoding)
pip install pilk
```

## How It Works

```
WeChat User ←→ Tencent ilinkai API ←→ wechat-to-anything ←→ Your Agent (HTTP)
```

Directly calls Tencent's ilinkai API to send/receive WeChat messages. No middleware, no reverse engineering, no web client. Your Agent just needs an OpenAI-compatible HTTP endpoint.

## Bring Your Own Agent

Any language — just expose `POST /v1/chat/completions`:

```python
@app.post("/v1/chat/completions")
def chat(request):
    message = request.json["messages"][-1]["content"]
    reply = your_agent(message)
    return {"choices": [{"message": {"role": "assistant", "content": reply}}]}
```

Then: `npx wechat-to-anything http://your-agent:8000/v1`

## Media Protocol

Include specific formats in Agent responses to automatically send media:

| Type | Agent Response Format | Notes |
|------|----------------------|-------|
| Image | `![desc](URL or path)` | URL, local path, or data URI |
| Voice | `[audio:path or URL]` | MP3/WAV/OGG, requires `ffmpeg` + `pilk` |
| Video | `[video:path or URL]` | Requires `ffmpeg` |
| File | `[file:path or URL]` | Any file type |

**Image receiving** (WeChat → Agent) follows the [OpenAI Vision API](https://platform.openai.com/docs/guides/vision):

```json
{
  "messages": [{
    "role": "user",
    "content": [
      { "type": "text", "text": "What is this?" },
      { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,..." } }
    ]
  }]
}
```

> Examples: [image-test.mjs](examples/image-test.mjs) · [voice-test.mjs](examples/voice-test.mjs) · [video-test-local.mjs](examples/video-test-local.mjs) · [file-test.mjs](examples/file-test.mjs)

## Multi-Agent Mode

Connect multiple Agents simultaneously, route with `@` prefix. Supports OpenAI format and [ACP](https://agentcommunicationprotocol.dev/):

```bash
npx wechat-to-anything \
  --agent codex=http://localhost:3001/v1 \
  --agent gemini=http://localhost:3002/v1 \
  --agent bee=acp://localhost:8000/chat \
  --default codex
```

| WeChat Message | Effect |
|---|---|
| `Hello` | Sent to default Agent |
| `@codex write a sort` | Routes to Codex |
| `@gemini review code` | Routes to Gemini |
| `@list` | List all Agents |
| `@switch gemini` | Switch default |

## Credentials

Login credentials are saved in `~/.wechat-to-anything/credentials.json`. Delete to re-login.

## Star History

If this project helped you, please give it a ⭐ Star — it's the best support!

## License

[MIT](LICENSE)
