import pc from "picocolors";
import {
  loadCredentials, loginWithQR, getUpdates,
  sendMessage, sendImageByUrl,
  extractText, extractMedia,
} from "./weixin.mjs";
import { downloadAndDecrypt, downloadMediaToFile } from "./cdn.mjs";

/**
 * 启动桥：WeChat ilinkai API ←→ Agent HTTP
 * 支持文本 + 图片 + 语音 + 文件，双向
 */
export async function start(agentUrl) {
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

  // 2. 检查 Agent 是否可达
  console.log(pc.dim(`🔍 检查 Agent: ${agentUrl}`));
  try {
    await fetch(agentUrl, { signal: AbortSignal.timeout(5000) });
    console.log(pc.green("✅ Agent 可达"));
  } catch {
    console.error(pc.red(`❌ 无法连接 Agent: ${agentUrl}`));
    process.exit(1);
  }

  // 3. 启动消息循环
  console.log(pc.green("🚀 桥已启动（支持文本/图片/语音/文件）"));
  console.log(pc.dim("   微信消息 → Agent → 微信回复"));
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

          // 调用 Agent
          try {
            const reply = await callAgent(agentUrl, agentMessages);
            // 检查回复是否包含图片 URL（markdown 格式）
            const imageMatch = reply.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
            if (imageMatch) {
              // Agent 回复了图片 URL → 直接发到微信
              const imageUrl = imageMatch[1];
              const textPart = reply.replace(/!\[.*?\]\(https?:\/\/[^\s)]+\)/g, "").trim();
              console.log(pc.green(`→ [Agent] [图片] ${imageUrl.slice(0, 60)}`));
              try {
                if (textPart) await sendMessage(creds.token, from, textPart, contextToken);
                await sendImageByUrl(creds.token, from, contextToken, imageUrl);
              } catch (err) {
                console.error(pc.red(`   图片发送失败: ${err.message}`));
                await sendMessage(creds.token, from, reply, contextToken);
              }
            } else {
              // 纯文本回复
              console.log(pc.green(`→ [Agent] ${reply.slice(0, 80)}${reply.length > 80 ? "..." : ""}`));
              await sendMessage(creds.token, from, reply, contextToken);
            }
          } catch (err) {
            console.error(pc.red(`   Agent 错误: ${err.message}`));
            await sendMessage(creds.token, from, `⚠️ Agent 错误: ${err.message}`, contextToken);
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

/**
 * 调用 Agent — 支持纯文本和多模态消息
 */
async function callAgent(agentUrl, messages) {
  const res = await fetch(`${agentUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "(empty response)";
}
