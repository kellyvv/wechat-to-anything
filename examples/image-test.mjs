import { readFileSync } from "fs";
import { homedir } from "os";

// 凭证
const creds = JSON.parse(readFileSync(homedir() + "/.wechat-to-anything/credentials.json", "utf-8"));
const token = creds.token;
const to = creds.userId;

// 测试图片 URL（可替换为任意图片地址）
const imageUrl = "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png";

// 获取 contextToken
const { getUpdates, buildHeaders, BASE_URL } = await import("../cli/weixin.mjs");
const msgs = await getUpdates(token);
const contextToken = msgs?.context_token || "";

// 发送图片
console.log("发送图片:", imageUrl.slice(0, 60) + "...");
const { sendImageByUrl } = await import("../cli/weixin.mjs");
await sendImageByUrl(token, to, contextToken, imageUrl);
console.log("✅ 图片已发送");
