/**
 * Markdown → 纯文本
 *
 * 微信不渲染 markdown，需要剥离语法。
 *
 * 2 层剥离，参考 OpenClaw：
 *   层 1: openclaw-weixin send.ts#L20-35 — 代码块/图片/链接/表格
 *   层 2: OpenClaw markdown-to-line.ts#L344-375 — bold/italic/headers/quotes/rules
 */

/**
 * 剥离 markdown 语法，返回纯文本
 * @param {string} text
 * @returns {string}
 */
export function stripMarkdown(text) {
  let r = text;

  // === 层 1: 结构化 markdown（weixin send.ts） ===
  // 代码块 → 保留内容
  r = r.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, code) => code.trim());
  // 图片标记 → 删除
  r = r.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  // 链接 → 保留文字
  r = r.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // 表格分隔行 → 删除
  r = r.replace(/^\|[\s:|-]+\|$/gm, "");
  // 表格行 → 空格分隔
  r = r.replace(/^\|(.+)\|$/gm, (_, inner) =>
    inner.split("|").map((c) => c.trim()).join("  "));

  // === 层 2: inline markdown（markdown-to-line.ts） ===
  // **粗体** / __粗体__
  r = r.replace(/\*\*(.+?)\*\*/g, "$1");
  r = r.replace(/__(.+?)__/g, "$1");
  // *斜体*（lookbehind 避免误匹配 **）
  r = r.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1");
  r = r.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, "$1");
  // ~~删除线~~
  r = r.replace(/~~(.+?)~~/g, "$1");
  // # 标题 → 保留文字
  r = r.replace(/^#{1,6}\s+(.+)$/gm, "$1");
  // > 引用 → 保留内容
  r = r.replace(/^>\s?(.*)$/gm, "$1");
  // ---, ***, ___ 分隔线 → 删除
  r = r.replace(/^[-*_]{3,}$/gm, "");
  // `行内代码` → 保留内容
  r = r.replace(/`([^`]+)`/g, "$1");
  // 多余空行
  r = r.replace(/\n{3,}/g, "\n\n");

  return r.trim();
}
