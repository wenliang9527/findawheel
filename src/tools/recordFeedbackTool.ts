// src/tools/recordFeedbackTool.ts
// record_feedback 工具: AI 根据用户反应记录对 wheel 的反馈(like/hide/click)。
// 反馈持久化到 ~/.findawheel/feedback/, 用于后续搜索排序加权。
import type { FeedbackStore, FeedbackAction } from '../feedback/feedbackStore.js';
import { FEEDBACK_ACTIONS } from '../feedback/feedbackStore.js';
import type { McpToolResult } from './types.js';
import { isValidOwnerRepo } from '../util/nameValidator.js';

export interface RecordFeedbackInput {
  /** wheel 标识, owner/repo 格式(与 find_wheel 返回的 name 一致) */
  name: string;
  /** 反馈动作: like(点赞) / hide(隐藏) / click(点击查看) */
  action: FeedbackAction;
}

export interface CreateRecordFeedbackToolOpts {
  /** 反馈存储实例(测试可注入 mock) */
  store: FeedbackStore;
}

/**
 * record_feedback 工具: 记录用户对某个 wheel 的反馈。
 * AI 在展示 find_wheel 结果后, 根据用户反应调用此工具:
 * - 用户点赞/说好用 → action='like'
 * - 用户说不相关/让 AI 别再推荐 → action='hide'
 * - 用户点开链接查看 → action='click'
 *
 * 反馈累积影响后续搜索排序: like 加分, hide 扣分, click 小幅加分。
 */
export function createRecordFeedbackTool(opts: CreateRecordFeedbackToolOpts) {
  async function handle(input: RecordFeedbackInput): Promise<McpToolResult> {
    // 校验 name: 必须是 owner/repo 格式
    if (!input.name || !isValidOwnerRepo(input.name)) {
      return {
        content: [{ type: 'text', text: 'invalid name: expected owner/repo format (e.g., facebook/react)' }],
        isError: true,
      };
    }
    // 校验 action: 必须是合法值(P1-11:复用 feedbackStore 导出的 FEEDBACK_ACTIONS)
    if (!FEEDBACK_ACTIONS.includes(input.action)) {
      return {
        content: [{ type: 'text', text: `invalid action: expected one of ${FEEDBACK_ACTIONS.join('/')}, got '${input.action}'` }],
        isError: true,
      };
    }

    const record = await opts.store.recordFeedback(input.name, input.action);
    if (!record) {
      // store 返回 null: 可能是 enabled=false 或磁盘写入失败
      return {
        content: [{ type: 'text', text: `feedback recorded (in-memory only, store disabled or disk error): ${input.name} ${input.action}` }],
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          name: record.name,
          action: input.action,
          totalLikes: record.likes,
          totalHides: record.hides,
          totalClicks: record.clicks,
          lastAction: record.lastAction,
          message: `feedback recorded: ${input.action} for ${input.name}`,
        }),
      }],
    };
  }

  return { handle };
}
