// src/util/nameValidator.ts
// wheel name 校验,被 getWheelDetailsTool / recordFeedbackTool / wheelDetailsEnricher 复用。
//
// 提供两个校验函数(注意:不是别名,各自语义不同):
// - isValidWheelName: 宽松校验,接受任何非空字符串(仅拒绝路径穿越/空串/纯空格/超长)。
//   适用于 feedback 等需要兼容 npm/crates/pypi/maven/rubygems/gopkg/vscode-marketplace/github-code
//   等多源 name 格式的场景(各源 name 格式不同,无法用单一正则覆盖)。
// - isValidOwnerRepo: 严格 owner/repo 正则校验,仅供 GitHub 专属工具使用
//   (getWheelDetailsTool 构造 https://github.com/${name}、wheelDetailsEnricher 调用
//   https://api.github.com/repos/${name}/readme),避免构造出畸形的 GitHub URL。
//   保持严格以维持这些工具的既有行为与测试(向后兼容)。

/** owner/repo 正则:owner 和 repo 都只允许 [a-zA-Z0-9._-],中间一个 / */
const OWNER_REPO_RE = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;

/**
 * 校验 name 是否为合法的 owner/repo 格式(GitHub 专属工具用)。
 * 合法: "facebook/react"、"owner/repo.name"、"a-b/c_d"
 * 非法: "foo"、"foo/"、"/bar"、"a/b/c"、"///"
 */
export function isValidOwnerRepo(name: string): boolean {
  return OWNER_REPO_RE.test(name);
}

/**
 * 校验 wheel name 是否合法(宽松,适用于 feedback 等多源场景)。
 * 不再强制 owner/repo 格式(因为 npm/crates/pypi/maven/rubygems/gopkg/vscode-marketplace/github-code
 * 等源的 name 格式各不相同)。仅拒绝路径穿越字符和空字符串。
 */
export function isValidWheelName(name: string): boolean {
  if (!name || typeof name !== 'string') return false;
  // 拒绝路径穿越
  if (name.includes('..') || name.includes('\0')) return false;
  // 拒绝纯空格
  if (name.trim() === '') return false;
  // 长度限制(防止恶意超长 name)
  if (name.length > 200) return false;
  return true;
}
