import pc from "picocolors";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import {
  loadCredentials, loginWithQR, getUpdates,
  sendMessage, sendImageMessage, sendFileMessage,
  extractText, extractMedia,
} from "./weixin.mjs";
import { downloadAndDecrypt, downloadMediaToFile, uploadToCdn } from "./cdn.mjs";

const MEDIA_DIR = resolve(homedir(), ".wechat-to-anything", "media");

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

  const loop = async () => {
    while (true) {
      try {
        const result = await getUpdates(creds.token, getUpdatesBuf);
        getUpdatesBuf = result.get_updates_buf;

        for (const msg of result.msgs) {
          const from = msg.from_user_id || "";
          const contextToken = msg.context_token || "";
          if (!from) continue;

          const text = extractText(msg);
          const media = extractMedia(msg);

          // 构建发给 Agent 的消息
          let agentMessages;

          if (media?.type === "image") {
            // 图片：下载解密 → base64 → 发给 Agent（多模态）
            console.log(pc.cyan(`← [微信] ${from}: [图片]`));
            try {
              const buf = await downloadAndDecrypt(media.encryptQueryParam, media.aesKey);
              const base64 = buf.toString("base64");
              agentMessages = [{
                role: "user",
                content: [
                  ...(text ? [{ type: "text", text }] : [{ type: "text", text: "请描述这张图片" }]),
                  { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } },
                ],
              }];
            } catch (err) {
              console.error(pc.red(`   图片下载失败: ${err.message}`));
              continue;
            }
          } else if (media?.type === "voice") {
            // 语音：优先使用微信自带转文字
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
            // 文件：下载并发描述给 Agent
            console.log(pc.cyan(`← [微信] ${from}: [文件] ${media.fileName}`));
            try {
              const { buffer } = await downloadMediaToFile(media.encryptQueryParam, media.aesKey, media.fileName.split(".").pop());
              // 尝试作为文本读取（小文件）
              if (buffer.length < 100_000) {
                const content = buffer.toString("utf-8");
                // 检查是否是文本文件
                if (!content.includes("\x00")) {
                  agentMessages = [{
                    role: "user",
                    content: `用户发送了文件 "${media.fileName}"，内容如下：\n\n${content}`,
                  }];
                } else {
                  agentMessages = [{
                    role: "user",
                    content: `用户发送了文件 "${media.fileName}"（${(buffer.length / 1024).toFixed(1)} KB，二进制文件）`,
                  }];
                }
              } else {
                agentMessages = [{
                  role: "user",
                  content: `用户发送了文件 "${media.fileName}"（${(buffer.length / 1024).toFixed(1)} KB）`,
                }];
              }
            } catch (err) {
              console.error(pc.red(`   文件下载失败: ${err.message}`));
              continue;
            }
          } else if (media?.type === "video") {
            console.log(pc.cyan(`← [微信] ${from}: [视频]`));
            agentMessages = [{ role: "user", content: "用户发送了一段视频" }];
          } else if (text) {
            // 纯文本
            console.log(pc.cyan(`← [微信] ${from}: ${text.slice(0, 80)}${text.length > 80 ? "..." : ""}`));
            agentMessages = [{ role: "user", content: text }];
          } else {
            continue;
          }

          // 调用 Agent
          try {
            const reply = await callAgent(agentUrl, agentMessages);
            // 检查回复是否包含图片 URL（markdown 格式）
            const imageMatch = reply.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
            if (imageMatch) {
              // Agent 回复了图片
              const imageUrl = imageMatch[1];
              const textPart = reply.replace(/!\[.*?\]\(https?:\/\/[^\s)]+\)/g, "").trim();
              console.log(pc.green(`→ [Agent] [图片] ${imageUrl.slice(0, 60)}`));
              try {
                // 下载图片到临时文件
                await mkdir(MEDIA_DIR, { recursive: true });
                const imgRes = await fetch(imageUrl);
                if (imgRes.ok) {
                  const imgBuf = Buffer.from(await imgRes.arrayBuffer());
                  const tmpPath = resolve(MEDIA_DIR, `out-${Date.now()}.jpg`);
                  await writeFile(tmpPath, imgBuf);
                  // 上传到 CDN 并发送
                  const uploaded = await uploadToCdn(tmpPath, from, creds.token, 1);
                  if (textPart) await sendMessage(creds.token, from, textPart, contextToken);
                  await sendImageMessage(creds.token, from, contextToken, uploaded);
                } else {
                  // 下载失败，发文本
                  await sendMessage(creds.token, from, reply, contextToken);
                }
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
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "(empty response)";
}
