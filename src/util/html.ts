// src/util/html.ts
// 通用 HTML 实体解码工具(底层 util,不依赖 sources/enrich 等上层模块)。
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
