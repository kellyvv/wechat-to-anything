/**
 * ilinkai WeChat API — 直接调用腾讯 ilinkai 接口
 *
 * 完全独立，不依赖 OpenClaw。
 *
 * 三类 API：
 *   1. 登录：get_bot_qrcode + get_qrcode_status（获取 token）
 *   2. 收消息：getupdates（long-poll）
 *   3. 发消息：sendmessage
 */

import crypto from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir, tmpdir } from "node:os";

export const BASE_URL = "https://ilinkai.weixin.qq.com";
const LONG_POLL_TIMEOUT_MS = 35_000;
const API_TIMEOUT_MS = 15_000;
const BOT_TYPE = "3";

// ─── 凭证管理 ───────────────────────────────────────────────────────

const CRED_DIR = resolve(homedir(), ".wechat-to-anything");
const CRED_FILE = resolve(CRED_DIR, "credentials.json");

export function loadCredentials() {
  try {
    if (!existsSync(CRED_FILE)) return null;
    const data = JSON.parse(readFileSync(CRED_FILE, "utf-8"));
    if (!data.token) return null;
    return data;
  } catch {
    return null;
  }
}

function saveCredentials(data) {
  mkdirSync(CRED_DIR, { recursive: true });
  writeFileSync(CRED_FILE, JSON.stringify(data, null, 2) + "\n");
}

// ─── QR 扫码登录 ────────────────────────────────────────────────────

/**
 * 获取登录二维码
 * @returns {{ qrcode: string, qrcode_img_content: string }}
 */
export async function getQRCode() {
  const url = `${BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`获取二维码失败: ${res.status}`);
  return res.json();
}

/**
 * 轮询二维码状态（long-poll）
 * @returns {{ status: 'wait'|'scaned'|'confirmed'|'expired', bot_token?, ilink_bot_id?, baseurl?, ilink_user_id? }}
 */
export async function pollQRStatus(qrcode) {
  const url = `${BASE_URL}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LONG_POLL_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "iLink-App-ClientVersion": "1" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`轮询状态失败: ${res.status}`);
    return res.json();
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") return { status: "wait" };
    throw err;
  }
}

/**
 * 完整 QR 登录流程
 * @returns {{ token, accountId, baseUrl, userId }}
 */
export async function loginWithQR(onQrCode) {
  const qr = await getQRCode();
  await onQrCode(qr.qrcode_img_content);

  const deadline = Date.now() + 5 * 60_000; // 5 min
  while (Date.now() < deadline) {
    const status = await pollQRStatus(qr.qrcode);

    if (status.status === "scaned") {
      process.stdout.write("👀 已扫码，请在微信确认...\n");
    }

    if (status.status === "confirmed") {
      const creds = {
        token: status.bot_token,
        accountId: status.ilink_bot_id,
        baseUrl: status.baseurl || BASE_URL,
        userId: status.ilink_user_id,
        savedAt: new Date().toISOString(),
      };
      saveCredentials(creds);
      return creds;
    }

    if (status.status === "expired") {
      throw new Error("二维码已过期，请重试");
    }

    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("登录超时");
}

// ─── 消息 API ───────────────────────────────────────────────────────

export function buildHeaders(token, bodyStr) {
  const uin = crypto.randomBytes(4).readUInt32BE(0);
  return {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    Authorization: `Bearer ${token}`,
    "Content-Length": String(Buffer.byteLength(bodyStr, "utf-8")),
    "X-WECHAT-UIN": Buffer.from(String(uin), "utf-8").toString("base64"),
  };
}

async function apiPost(endpoint, body, token, timeoutMs) {
  const url = `${BASE_URL}/${endpoint}`;
  const bodyStr = JSON.stringify(body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: buildHeaders(token, bodyStr),
      body: bodyStr,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await res.text();
    if (!res.ok) throw new Error(`${endpoint} ${res.status}: ${text}`);
    return JSON.parse(text);
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") return null;
    throw err;
  }
}

export async function getUpdates(token, getUpdatesBuf = "") {
  const resp = await apiPost(
    "ilink/bot/getupdates",
    { get_updates_buf: getUpdatesBuf, base_info: {} },
    token,
    LONG_POLL_TIMEOUT_MS
  );
  if (!resp) return { msgs: [], get_updates_buf: getUpdatesBuf };
  if (resp.ret !== 0 && resp.ret !== undefined) {
    throw new Error(`getUpdates: ret=${resp.ret} errcode=${resp.errcode} ${resp.errmsg || ""}`);
  }
  return {
    msgs: resp.msgs || [],
    get_updates_buf: resp.get_updates_buf || getUpdatesBuf,
  };
}

export async function sendMessage(token, to, text, contextToken) {
  await apiPost(
    "ilink/bot/sendmessage",
    {
      msg: {
        from_user_id: "",
        to_user_id: to,
        client_id: crypto.randomUUID(),
        message_type: 2,
        message_state: 2,
        item_list: [{ type: 1, text_item: { text } }],
        context_token: contextToken,
      },
      base_info: {},
    },
    token,
    API_TIMEOUT_MS
  );
}

/**
 * 发送图片消息（下载 → 生成缩略图 → CDN 上传原图+缩略图 → 发送 HD）
 */
export async function sendImageByUrl(token, to, contextToken, imageUrl) {
  const { writeFile: wf, readFile: rf } = await import("node:fs/promises");

  // 获取图片数据
  let tmpPath;
  if (imageUrl.startsWith("/")) {
    // 本地文件路径，直接使用
    tmpPath = imageUrl;
  } else {
    let buf;
    if (imageUrl.startsWith("data:")) {
      const b64 = imageUrl.split(",")[1];
      buf = Buffer.from(b64, "base64");
    } else {
      const resp = await fetch(imageUrl);
      if (!resp.ok) throw new Error(`图片下载失败: ${resp.status}`);
      buf = Buffer.from(await resp.arrayBuffer());
    }
    tmpPath = "/tmp/wxta_image_send.jpg";
    await wf(tmpPath, buf);
  }

  // CDN 上传（含缩略图，确保高清显示）
  const { uploadImageWithThumb } = await import("./cdn.mjs");
  const cdn = await uploadImageWithThumb(tmpPath, to, token);
  const aesKeyB64 = Buffer.from(cdn.aeskey).toString("base64");

  // 构造 image_item
  const imageItem = {
    media: {
      encrypt_query_param: cdn.downloadParam,
      aes_key: aesKeyB64,
    },
    mid_size: cdn.fileSizeCiphertext,
  };
  if (cdn.thumbDownloadParam) {
    imageItem.thumb_media = {
      encrypt_query_param: cdn.thumbDownloadParam,
      aes_key: aesKeyB64,
    };
    imageItem.thumb_size = cdn.thumbSizeCiphertext;
    imageItem.thumb_width = cdn.thumbWidth;
    imageItem.thumb_height = cdn.thumbHeight;
  }

  // 发送
  await apiPost(
    "ilink/bot/sendmessage",
    {
      msg: {
        from_user_id: "",
        to_user_id: to,
        client_id: crypto.randomUUID(),
        message_type: 2,
        message_state: 2,
        item_list: [{ type: 2, image_item: imageItem }],
        context_token: contextToken,
      },
      base_info: {},
    },
    token,
    API_TIMEOUT_MS
  );
}

/**
 * 发送语音消息（base64 音频数据）
 */
export async function sendVoiceMessage(token, to, contextToken, audioBase64, durationSec) {
  await apiPost(
    "ilink/bot/sendmessage",
    {
      msg: {
        from_user_id: "",
        to_user_id: to,
        client_id: crypto.randomUUID(),
        message_type: 2,
        message_state: 2,
        item_list: [{
          type: 3, // VOICE
          voice_item: {
            url: `data:audio/mpeg;base64,${audioBase64}`,
            duration: durationSec || 5,
          },
        }],
        context_token: contextToken,
      },
      base_info: {},
    },
    token,
    API_TIMEOUT_MS
  );
}


/**
 * 发送文件消息（通过 CDN 引用）
 */
export async function sendFileMessage(token, to, contextToken, uploaded, fileName) {
  await apiPost(
    "ilink/bot/sendmessage",
    {
      msg: {
        from_user_id: "",
        to_user_id: to,
        client_id: crypto.randomUUID(),
        message_type: 2,
        message_state: 2,
        item_list: [{
          type: 4, // FILE
          file_item: {
            media: {
              encrypt_query_param: uploaded.downloadParam,
              aes_key: Buffer.from(uploaded.aeskey, "hex").toString("base64"),
              encrypt_type: 1,
            },
            file_name: fileName,
            len: String(uploaded.fileSize),
          },
        }],
        context_token: contextToken,
      },
      base_info: {},
    },
    token,
    API_TIMEOUT_MS
  );
}

/**
 * 发送视频消息（通过 URL 下载 → CDN 上传 → 发送）
 * 参考: openclaw-weixin send.ts#L209-233 (sendVideoMessageWeixin)
 */
export async function sendVideoByUrl(token, to, contextToken, videoUrl) {
  const { uploadToCdn } = await import("./cdn.mjs");

  // 下载视频
  const resp = await fetch(videoUrl);
  if (!resp.ok) throw new Error(`video download failed: ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  const tmpPath = join(tmpdir(), `wx-video-${Date.now()}.mp4`);
  writeFileSync(tmpPath, buf);

  try {
    // CDN 上传 (mediaType=2=VIDEO)
    const uploaded = await uploadToCdn(tmpPath, to, token, 2);

    // 发送 type:5 video_item
    await apiPost(
      "ilink/bot/sendmessage",
      {
        msg: {
          from_user_id: "",
          to_user_id: to,
          client_id: crypto.randomUUID(),
          message_type: 2,
          message_state: 2,
          item_list: [{
            type: 5, // VIDEO
            video_item: {
              media: {
                encrypt_query_param: uploaded.downloadParam,
                aes_key: Buffer.from(uploaded.aeskey, "hex").toString("base64"),
              },
              video_size: uploaded.ciphertextSize,
            },
          }],
          context_token: contextToken,
        },
        base_info: {},
      },
      token,
      API_TIMEOUT_MS
    );
  } finally {
    try { unlinkSync(tmpPath); } catch {}
  }
}

/**
 * 获取 bot 配置（含 typing_ticket）
 * 参考: openclaw-weixin api.ts#L209-226
 */
export async function getConfig(token, userId, contextToken) {
  return apiPost(
    "ilink/bot/getconfig",
    { ilink_user_id: userId, context_token: contextToken },
    token,
    10_000
  );
}

/**
 * 发送打字指示器
 * 参考: openclaw-weixin api.ts#L228-240
 * @param {number} status — 1=typing, 2=cancel
 */
export async function sendTyping(token, userId, typingTicket, status = 1) {
  return apiPost(
    "ilink/bot/sendtyping",
    { ilink_user_id: userId, typing_ticket: typingTicket, status },
    token,
    10_000
  );
}

/**
 * 提取消息文本（支持语音转文字）
 */
export function extractText(msg) {
  const items = msg.item_list || [];
  for (const item of items) {
    if (item.type === 1 && item.text_item?.text) return item.text_item.text;
    // 语音转文字（微信自带）
    if (item.type === 3 && item.voice_item?.text) return item.voice_item.text;
  }
  return "";
}

/**
 * 提取多媒体信息
 * @returns {{ type: 'image'|'voice'|'file'|'video', encryptQueryParam, aesKey, fileName?, voiceText? } | null}
 */
export function extractMedia(msg) {
  const items = msg.item_list || [];
  for (const item of items) {
    // 图片
    if (item.type === 2 && item.image_item?.media?.encrypt_query_param) {
      const img = item.image_item;
      // 图片 AES key 可能在 image_item.aeskey (hex) 或 media.aes_key (base64)
      const aesKey = img.aeskey
        ? Buffer.from(img.aeskey, "hex").toString("base64")
        : img.media.aes_key;
      return {
        type: "image",
        encryptQueryParam: img.media.encrypt_query_param,
        aesKey, // 可能 undefined（不加密的图片）
      };
    }
    // 语音
    if (item.type === 3 && item.voice_item?.media?.encrypt_query_param) {
      return {
        type: "voice",
        encryptQueryParam: item.voice_item.media.encrypt_query_param,
        aesKey: item.voice_item.media.aes_key,
        voiceText: item.voice_item.text || null, // 微信自带语音转文字
      };
    }
    // 文件
    if (item.type === 4 && item.file_item?.media?.encrypt_query_param) {
      return {
        type: "file",
        encryptQueryParam: item.file_item.media.encrypt_query_param,
        aesKey: item.file_item.media.aes_key,
        fileName: item.file_item.file_name || "file.bin",
      };
    }
    // 视频
    if (item.type === 5 && item.video_item?.media?.encrypt_query_param) {
      return {
        type: "video",
        encryptQueryParam: item.video_item.media.encrypt_query_param,
        aesKey: item.video_item.media.aes_key,
      };
    }
  }
  return null;
}

