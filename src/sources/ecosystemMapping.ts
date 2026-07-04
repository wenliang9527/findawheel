// src/sources/ecosystemMapping.ts
// 技术栈 ecosystem → 语言名称映射表。
// 被 github / githubCode / gitee 三个适配器复用,避免重复定义导致不同步。
//
// 注:'c' 故意不映射 —— C 项目在 GitHub/Gitee 上常被标记为 C/C++/Arduino,
// 限制成单一语言会漏掉主流库。用户想精确搜时可用 ecosystem=cpp 或 ecosystem=arduino。

export const ECOSYSTEM_LANG: Record<string, string> = {
  js: 'JavaScript',
  ts: 'TypeScript',
  python: 'Python',
  rust: 'Rust',
  go: 'Go',
  java: 'Java',
  cpp: 'C++',
  arduino: 'Arduino',
};
