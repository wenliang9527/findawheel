// src/util/html.ts
// 通用 HTML 工具(底层 util,不依赖 sources/enrich 等上层模块)。
// 之前定义在 pypiSourceAdapter 内,被 goModuleSourceAdapter 跨文件依赖,
// 导致两个平行适配器耦合。下沉到 util 层消除反向依赖。

/** 解码常见 HTML 实体(避免引入完整 HTML 解析依赖) */
export function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * 将 HTML 转换为简洁的 markdown 文本。
 * 保留标题/代码/链接文本,移除图片/badge/script/style。
 * 对纯 markdown 文本幂等(无 HTML 时原样返回),否则会破坏 README 正文。
 * 代码块转 ``` 围栏,后续 codeSnippetExtractor 才能正确提取。
 */
export function htmlToText(html: string): string {
  if (!html) return '';
  let text = html;

  // 1. 移除 script/style 块和 HTML 注释
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  // 2. 移除 img 标签:badge/shield/icon 开头的 alt 丢弃,其他 alt 保留为文本
  text = text.replace(/<img[^>]*alt="([^"]*)"[^>]*\/?>/gi, (_, alt: string) =>
    alt && !alt.match(/^(badge|shield|icon)/i) ? alt : '',
  );
  text = text.replace(/<img[^>]*>/gi, '');

  // 3. 标题转 markdown
  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
  text = text.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n');

  // 4. 代码块转 markdown 围栏(pre>code 先,inline code 后)
  text = text.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n');
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');

  // 5. 链接保留文本,去 URL
  text = text.replace(/<a[^>]*>([\s\S]*?)<\/a>/gi, '$1');

  // 6. 列表项
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');

  // 7. 段落/换行
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n');

  // 8. 移除剩余所有标签(div/span/ul/ol 等)
  text = text.replace(/<[^>]+>/g, '');

  // 9. HTML 实体解码(含 &nbsp;)
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  // 10. 压缩 3+ 连续换行为 2,并 trim 首尾空白
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return text;
}
