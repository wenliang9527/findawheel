// src/util/nameValidator.ts
// owner/repo 格式校验,被 getWheelDetailsTool / recordFeedbackTool / wheelDetailsEnricher 复用。
// 严格校验避免非法格式(如 "foo/"、"/bar"、"a/b/c/d"、"///")被拼进 URL 或文件路径。

/** owner/repo 正则:owner 和 repo 都只允许 [a-zA-Z0-9._-],中间一个 / */
const OWNER_REPO_RE = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;

/**
 * 校验 name 是否为合法的 owner/repo 格式。
 * 合法: "facebook/react"、"owner/repo.name"、"a-b/c_d"
 * 非法: "foo"、"foo/"、"/bar"、"a/b/c"、"///"
 */
export function isValidOwnerRepo(name: string): boolean {
  return OWNER_REPO_RE.test(name);
}
