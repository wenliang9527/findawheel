// src/tools/types.ts
// MCP 工具返回结果的公共类型,被所有 Tool 文件复用。
// 避免在 findWheelTool/getWheelDetailsTool/recordFeedbackTool 各自重复定义。

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}
