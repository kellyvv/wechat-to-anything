/**
 * 腾讯 WeChat CDN 加解密 + 上传下载
 *
 * 微信多媒体文件通过 CDN 传输，使用 AES-128-ECB 加密。
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";

const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
const MEDIA_DIR = resolve(homedir(), ".wechat-to-anything", "media");

/** AES-128-ECB 加密 */
function encryptAesEcb(plaintext, key) {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

/** AES-128-ECB 解密 */
function decryptAesEcb(ciphertext, key) {
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** 计算 AES-128-ECB 密文大小（PKCS7 填充） */
function aesEcbPaddedSize(plaintextSize) {
  return Math.ceil((plaintextSize + 1) / 16) * 16;
}

/**
 * 解析 AES key（两种编码）
 * - base64(16字节) → 图片
 * - base64(32字符hex) → 语音/文件/视频
 */
function parseAesKey(aesKeyBase64) {
  const decoded = Buffer.from(aesKeyBase64, "base64");
  if (decoded.length === 16) return decoded;
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString("ascii"))) {
    return Buffer.from(decoded.toString("ascii"), "hex");
  }
  throw new Error(`Invalid AES key length: ${decoded.length}`);
}

// ─── 下载 ───────────────────────────────────────────────────────────

/**
 * 从 CDN 下载并解密多媒体文件
 * @returns {Buffer} 解密后的文件内容
 */
export async function downloadAndDecrypt(encryptQueryParam, aesKeyBase64) {
  const url = `${CDN_BASE_URL}/download?encrypted_query_param=${encodeURIComponent(encryptQueryParam)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CDN download failed: ${res.status}`);
  const encrypted = Buffer.from(await res.arrayBuffer());
  if (!aesKeyBase64) return encrypted; // 不加密的情况
  const key = parseAesKey(aesKeyBase64);
  return decryptAesEcb(encrypted, key);
}

/**
 * 下载媒体到本地临时文件
 * @returns {string} 保存的文件路径
 */
export async function downloadMediaToFile(encryptQueryParam, aesKeyBase64, ext = "bin") {
  await mkdir(MEDIA_DIR, { recursive: true });
  const buf = await downloadAndDecrypt(encryptQueryParam, aesKeyBase64);
  const fileName = `${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
  const filePath = resolve(MEDIA_DIR, fileName);
  await writeFile(filePath, buf);
  return { filePath, buffer: buf };
}

// ─── 上传 ───────────────────────────────────────────────────────────

/**
 * 上传文件到微信 CDN
 * 流程：读文件 → hash → 生成 AES key → getUploadUrl → 加密上传 → 返回 CDN 引用
 *
 * @param {string} filePath 本地文件路径
 * @param {string} toUserId 目标用户 ID
 * @param {string} token bot token
 * @param {number} mediaType 1=IMAGE, 2=VIDEO, 3=FILE
 * @returns {{ downloadParam, aeskey, fileSize, fileSizeCiphertext, filekey }}
 */
export async function uploadToCdn(filePath, toUserId, token, mediaType = 1) {
  const { buildHeaders, BASE_URL } = await import("./weixin.mjs");

  const plaintext = await readFile(filePath);
  const rawsize = plaintext.length;
  const rawfilemd5 = createHash("md5").update(plaintext).digest("hex");
  const filesize = aesEcbPaddedSize(rawsize);
  const filekey = randomBytes(16).toString("hex");
  const aeskey = randomBytes(16);

  // 1. 获取上传 URL
  const uploadBody = JSON.stringify({
    filekey,
    media_type: mediaType,
    to_user_id: toUserId,
    rawsize,
    rawfilemd5,
    filesize,
    no_need_thumb: true,
    aeskey: aeskey.toString("hex"),
    base_info: {},
  });

  const uploadRes = await fetch(`${BASE_URL}/ilink/bot/getuploadurl`, {
    method: "POST",
    headers: buildHeaders(token, uploadBody),
    body: uploadBody,
  });
  if (!uploadRes.ok) throw new Error(`getUploadUrl failed: ${uploadRes.status}`);
  const { upload_param } = await uploadRes.json();
  if (!upload_param) throw new Error("getUploadUrl: no upload_param");

  // 2. 加密 + 上传到 CDN
  const ciphertext = encryptAesEcb(plaintext, aeskey);
  const cdnUrl = `${CDN_BASE_URL}/upload?encrypted_query_param=${encodeURIComponent(upload_param)}&filekey=${encodeURIComponent(filekey)}`;
  const cdnRes = await fetch(cdnUrl, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: new Uint8Array(ciphertext),
  });
  if (cdnRes.status !== 200) throw new Error(`CDN upload failed: ${cdnRes.status}`);
  const downloadParam = cdnRes.headers.get("x-encrypted-param");
  if (!downloadParam) throw new Error("CDN upload: missing x-encrypted-param");

  return {
    downloadParam,
    aeskey: aeskey.toString("hex"),
    fileSize: rawsize,
    fileSizeCiphertext: filesize,
    filekey,
  };
}
