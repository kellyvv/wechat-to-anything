import pc from "picocolors";
import {
  loadCredentials, loginWithQR, getUpdates,
  sendMessage, sendImageByUrl,
  extractText, extractMedia,
} from "./weixin.mjs";
import { downloadAndDecrypt, downloadMediaToFile } from "./cdn.mjs";
import { callAgentAuto, checkAgent } from "./agent-adapter.mjs";

/**
 * 启动桥：WeChat ilinkai API ←→ Agent HTTP
 * 支持文本 + 图片 + 语音 + 文件，双向
 */
export async function start(agents, defaultAgent) {
  // 兼容旧的单 URL 调用
  if (typeof agents === "string") {
    const url = agents;
    agents = new Map([["default", url]]);
    defaultAgent = "default";
  }

  const multiMode = agents.size > 1 || !agents.has("default");

  // 1. 读取或获取 WeChat 登录凭证
  let creds = loadCredentials();
  if (!creds) {
    console.log(pc.yellow("📱 首次使用，请扫码登录微信\n"));
    try {
      creds = await loginWithQR(async (qrUrl) => {
        try {
          const qrt = await import("qrcode-terminal");
          await new Promise((resolve) => {
            qrt.default.generate(qrUrl, { small: true }, (qr) => {
              console.log(qr);
              resolve();
            });
          });
        } catch {
          console.log(`扫码链接: ${qrUrl}`);
        }
      });
      console.log(pc.green("✅ 微信登录成功！"));
    } catch (err) {
      console.error(pc.red(`❌ 登录失败: ${err.message}`));
      process.exit(1);
    }
  }
  console.log(pc.green(`✅ 微信已登录`));

  // 2. 检查所有 Agent 是否可达
  for (const [name, url] of agents) {
    console.log(pc.dim(`🔍 检查 Agent ${name}: ${url}`));
    try {
      await checkAgent(url);
      console.log(pc.green(`✅ ${name} 可达`));
    } catch {
      console.error(pc.red(`❌ 无法连接 ${name}: ${url}`));
      process.exit(1);
    }
  }

  // 3. 启动消息循环
  console.log(pc.green("🚀 桥已启动（支持文本/图片/语音/文件）"));
  if (multiMode) {
    console.log(pc.dim(`   已注册 ${agents.size} 个 Agent，默认: ${defaultAgent}`));
    console.log(pc.dim(`   发 @list 查看，@切换 <name> 切换默认`));
  } else {
    console.log(pc.dim("   微信消息 → Agent → 微信回复"));
  }

  // per-user 默认 Agent
  const userDefaults = new Map();
  console.log();

  let getUpdatesBuf = "";

  // 每用户图片缓存：发图片时先存着，等下一条文字消息再合并发出
  const pendingImages = new Map(); // userId → { base64, timestamp }
  const IMAGE_BUFFER_TTL = 5 * 60_000; // 5 min 过期

  const loop = async () => {
    while (true) {
      try {
        const result = await getUpdates(creds.token, getUpdatesBuf);
        getUpdatesBuf = result.get_updates_buf;
        if (result.msgs.length > 0) {
          console.log(pc.dim(`   poll: ${result.msgs.length} 条消息`));
        }

        for (const msg of result.msgs) {
          const from = msg.from_user_id || "";
          const contextToken = msg.context_token || "";
          if (!from) continue;

          const text = extractText(msg);
          const media = extractMedia(msg);



          // 构建发给 Agent 的消息
          let agentMessages;

          if (media?.type === "image") {
            // 图片：下载解密，缓存 base64，等待用户发文字
            console.log(pc.cyan(`← [微信] ${from}: [图片] (等待文字问题...)`));
            try {
              const buf = await downloadAndDecrypt(media.encryptQueryParam, media.aesKey);
              pendingImages.set(from, {
                base64: buf.toString("base64"),
                timestamp: Date.now(),
                contextToken,
              });
            } catch (err) {
              console.error(pc.red(`   图片下载失败: ${err.message}`));
            }
            continue; // 不发给 Agent，等文字

          } else if (text) {
            // === 管理命令 ===
            if (multiMode && text.trim() === "@list") {
              const lines = [`📋 已注册 ${agents.size} 个 Agent:`];
              const userDefault = userDefaults.get(from) || defaultAgent;
              for (const [name, url] of agents) {
                lines.push(`${name === userDefault ? "  ★" : "  ·"} ${name} → ${url}`);
              }
              lines.push(`\n当前默认: ${userDefault}`);
              lines.push(`发 @切换 <name> 切换默认`);
              await sendMessage(creds.token, from, lines.join("\n"), contextToken);
              continue;
            }
            if (multiMode && text.trim().startsWith("@切换")) {
              const target = text.trim().replace(/^@切换\s*/, "").toLowerCase();
              if (agents.has(target)) {
                userDefaults.set(from, target);
                await sendMessage(creds.token, from, `✅ 默认 Agent 已切换为 ${target}`, contextToken);
              } else {
                await sendMessage(creds.token, from, `❌ Agent "${target}" 不存在，发 @list 查看可用列表`, contextToken);
              }
              continue;
            }

            // 文字消息：检查是否有缓存的图片
            const pending = pendingImages.get(from);
            if (pending && (Date.now() - pending.timestamp) < IMAGE_BUFFER_TTL) {
              // 有缓存图片 → 合并为多模态消息
              console.log(pc.cyan(`← [微信] ${from}: [图片+文字] ${text.slice(0, 80)}`));
              pendingImages.delete(from);
              agentMessages = [{
                role: "user",
                content: [
                  { type: "text", text },
                  { type: "image_url", image_url: { url: `data:image/jpeg;base64,${pending.base64}` } },
                ],
              }];
            } else {
              // 纯文本
              console.log(pc.cyan(`← [微信] ${from}: ${text.slice(0, 80)}${text.length > 80 ? "..." : ""}`));
              agentMessages = [{ role: "user", content: text }];
            }

          } else if (media?.type === "voice") {
            // 打印完整 voice_item 结构，用于对照发送格式
            const voiceItem = (msg.item_list || []).find(i => i.type === 3)?.voice_item;
            if (voiceItem) {
              console.log(pc.yellow("📋 收到的 voice_item 完整结构:"));
              console.log(JSON.stringify(voiceItem, null, 2));
            }
            const voiceText = media.voiceText || text;
            if (voiceText) {
              console.log(pc.cyan(`← [微信] ${from}: [语音] ${voiceText.slice(0, 80)}`));
              agentMessages = [{ role: "user", content: voiceText }];
            } else {
              console.log(pc.cyan(`← [微信] ${from}: [语音] (无法识别)`));
              await sendMessage(creds.token, from, "⚠️ 语音无法识别，请发文字", contextToken);
              continue;
            }
          } else if (media?.type === "file") {
            console.log(pc.cyan(`← [微信] ${from}: [文件] ${media.fileName}`));
            try {
              const { buffer } = await downloadMediaToFile(media.encryptQueryParam, media.aesKey, media.fileName.split(".").pop());
              if (buffer.length < 100_000) {
                const content = buffer.toString("utf-8");
                if (!content.includes("\x00")) {
                  agentMessages = [{ role: "user", content: `用户发送了文件 "${media.fileName}"，内容如下：\n\n${content}` }];
                } else {
                  agentMessages = [{ role: "user", content: `用户发送了文件 "${media.fileName}"（${(buffer.length / 1024).toFixed(1)} KB，二进制文件）` }];
                }
              } else {
                agentMessages = [{ role: "user", content: `用户发送了文件 "${media.fileName}"（${(buffer.length / 1024).toFixed(1)} KB）` }];
              }
            } catch (err) {
              console.error(pc.red(`   文件下载失败: ${err.message}`));
              continue;
            }
          } else if (media?.type === "video") {
            console.log(pc.cyan(`← [微信] ${from}: [视频]`));
            agentMessages = [{ role: "user", content: "用户发送了一段视频" }];
          } else {
            continue;
          }

          // === 语音测试触发器 ===
          if (text === "语音测试") {
            console.log(pc.yellow("🎤 语音测试..."));
            try {
              const { execSync } = await import("node:child_process");
              const { statSync } = await import("node:fs");
              const crypto = await import("node:crypto");
              const { buildHeaders, BASE_URL: baseUrl } = await import("./weixin.mjs");
              const { uploadToCdn } = await import("./cdn.mjs");

              // TTS → MP3 → PCM(16kHz) → SILK
              execSync(`python3 -m edge_tts --text "你好，这是一条AI语音消息测试" --voice zh-CN-XiaoxiaoNeural --write-media /tmp/tts_bridge.mp3`);
              execSync(`ffmpeg -y -i /tmp/tts_bridge.mp3 -ar 16000 -ac 1 -f s16le /tmp/tts_bridge.pcm 2>/dev/null`);
              execSync(`python3 -c "import pilk; pilk.encode('/tmp/tts_bridge.pcm', '/tmp/tts_bridge.silk', pcm_rate=16000, tencent=True)"`);
              const pcmSize = statSync("/tmp/tts_bridge.pcm").size;
              const durationMs = Math.round((pcmSize / 32000) * 1000);
              console.log(pc.dim(`   TTS+SILK 完成 (duration=${durationMs}ms)`));

              // CDN 上传 (mediaType=4 = 语音)
              const cdn = await uploadToCdn("/tmp/tts_bridge.silk", from, creds.token, 4);
              const aesKeyB64 = Buffer.from(cdn.aeskey).toString("base64");
              console.log(pc.dim(`   CDN 上传成功 (mediaType=4)`));

              // 发送语音消息
              const body = JSON.stringify({
                msg: {
                  from_user_id: "", to_user_id: from,
                  client_id: crypto.randomUUID(),
                  message_type: 2, message_state: 2,
                  item_list: [{
                    type: 3,
                    voice_item: {
                      media: {
                        encrypt_query_param: cdn.downloadParam,
                        aes_key: aesKeyB64,
                      },
                      encode_type: 4,
                      bits_per_sample: 16,
                      sample_rate: 16000,
                      playtime: durationMs,
                    },
                  }],
                  context_token: contextToken,
                },
                base_info: {},
              });
              const res = await fetch(`${baseUrl}/ilink/bot/sendmessage`, {
                method: "POST",
                headers: buildHeaders(creds.token, body),
                body,
              });
              console.log(pc.green(`→ [语音] status: ${res.status}`));
              await sendMessage(creds.token, from, `🎤 语音已发送 (${durationMs}ms)`, contextToken);
            } catch (err) {
              console.error(pc.red(`   语音测试失败: ${err.message}`));
              await sendMessage(creds.token, from, `⚠️ 语音测试失败: ${err.message}`, contextToken);
            }
            continue;
          }

          // 解析 @agentName 路由
          let targetAgent = userDefaults.get(from) || defaultAgent;
          let routedText = text;
          if (multiMode && text) {
            // 先尝试 @name 消息（有空格）
            const atMatch = text.match(/^@(\S+)\s+(.*)$/s);
            if (atMatch && agents.has(atMatch[1].toLowerCase())) {
              targetAgent = atMatch[1].toLowerCase();
              routedText = atMatch[2];
            } else {
              // 再尝试 @name消息（无空格）— 遍历已知 agent 名称
              for (const name of agents.keys()) {
                if (text.toLowerCase().startsWith(`@${name}`)) {
                  targetAgent = name;
                  routedText = text.slice(1 + name.length).trim() || text;
                  break;
                }
              }
            }
            // 更新 agentMessages 中的文本
            if (routedText !== text && agentMessages.length === 1 && typeof agentMessages[0].content === "string") {
              agentMessages[0].content = routedText;
            }
          }
          const agentUrl = agents.get(targetAgent);

          // 调用 Agent
          try {
            const reply = await callAgentAuto(agentUrl, agentMessages);
            // 检查回复是否包含图片 URL（markdown 格式）
            const imageMatch = reply.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
            const agentTag = multiMode ? `[${targetAgent}] ` : "";
            if (imageMatch) {
              // Agent 回复了图片 URL → 直接发到微信
              const imageUrl = imageMatch[1];
              const textPart = reply.replace(/!\[.*?\]\(https?:\/\/[^\s)]+\)/g, "").trim();
              console.log(pc.green(`→ [${targetAgent}] [图片] ${imageUrl.slice(0, 60)}`));
              try {
                if (textPart) await sendMessage(creds.token, from, agentTag + textPart, contextToken);
                await sendImageByUrl(creds.token, from, contextToken, imageUrl);
              } catch (err) {
                console.error(pc.red(`   图片发送失败: ${err.message}`));
                await sendMessage(creds.token, from, agentTag + reply, contextToken);
              }
            } else {
              // 纯文本回复
              console.log(pc.green(`→ [${targetAgent}] ${reply.slice(0, 80)}${reply.length > 80 ? "..." : ""}`));
              await sendMessage(creds.token, from, agentTag + reply, contextToken);
            }
          } catch (err) {
            console.error(pc.red(`   ${targetAgent} 错误: ${err.message}`));
            await sendMessage(creds.token, from, `⚠️ ${targetAgent} 错误: ${err.message}`, contextToken);
          }
        }
      } catch (err) {
        console.error(pc.yellow(`⚠️ ${err.message}`));
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  };

  process.on("SIGINT", () => {
    console.log(pc.dim("\n桥已停止"));
    process.exit(0);
  });

  await loop();
}

