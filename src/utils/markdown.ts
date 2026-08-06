/**
 * Markdown 渲染：marked 解析 + DOMPurify 消毒（防 XSS）。
 * renderMarkdown 用于备注展示（块级）。
 */
import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({
  gfm: true, // 任务列表、表格、删除线
  breaks: true, // 换行即 <br>，贴合笔记输入习惯
});

export function renderMarkdown(md: string): string {
  if (!md) return "";
  try {
    const html = marked.parse(md, { async: false }) as string;
    return DOMPurify.sanitize(html, { ADD_ATTR: ["target"] });
  } catch {
    return DOMPurify.sanitize(md);
  }
}
