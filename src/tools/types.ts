// src/tools/types.ts
// MCP 工具返回结果的公共类型,被所有 Tool 文件复用。
// 避免在 findWheelTool/getWheelDetailsTool/recordFeedbackTool 各自重复定义。
//
// 直接复用 SDK 的 CallToolResult 类型,避免 as unknown as CallToolResult 强制断言。
// SDK 类型 content 是 ContentBlock[](含 text/image/resource 等多种类型),
// 我们的实现只产出 text 类型,是 ContentBlock 的合法子集。

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export type McpToolResult = CallToolResult;
