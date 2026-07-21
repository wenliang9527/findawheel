// src/classifier/queryClassifier.ts
import type { Intent } from '../normalize/types.js';

export const PROJECT_SIGNALS = [
  'app', 'application', 'platform', 'tool', 'editor', 'dashboard',
  '系统', '平台', '应用', '编辑器', '网站', '管理系统',
];

export const FEATURE_SIGNALS = [
  'parse', 'convert', 'generate', 'compress', 'encrypt',
  'client', 'sdk', 'wrapper',
  '解析', '转换', '压缩', '加密', '客户端',
  // 硬件/嵌入式类(嵌入式领域 query 通常找驱动库/功能,而非完整项目)
  'driver', 'drive', 'control', 'controller', 'stepper', 'motor', 'servo',
  'pwm', 'pulse', 'encoder', 'hal',
  '驱动', '驱动器', '电机', '马达', '舵机', '脉冲', '编码器',
];

/**
 * 优化 13:"在现有项目中加功能"的强信号模式。
 *
 * 场景:用户说"我想在项目里加一个 PDF 导出功能",应分类为 feature
 * (找 npm 包/库),而非 project(完整项目)。原逻辑下此类 query 无任何
 * SIGNAL 命中,默认 project,导致 sourceRouter 优先 GitHub 源、跳过 npm。
 *
 * 模式说明:
 * - 加一个/添加/实现 + 功能:动作 + "功能"组合,强信号
 * - 在...项目/代码...加:"在现有项目里加"语境,强信号
 * - 集成/接入:本质是把已有库/服务接入项目,也是 feature
 *
 * 放在 PROJECT/FEATURE 关键词打分之前,作为强信号优先匹配返回 feature,
 * 避免被"一个"等词误判(虽然当前 SIGNALS 没有"一个",但模式匹配更明确)。
 *
 * 优化28(2026-07-20):修复"在代码中加一个驱动程序"被误判为 feature。
 * 原模式 /在.*代码.*加/ 会匹配"在代码中增加一个步进电机驱动程序",
 * 但语义是"做一个驱动程序"(project),不是"加一个功能"(feature)。
 * 修复:仅在"加功能/加特性/加模块/加组件"语境下才返回 feature,
 * 加"程序/库/驱动程序"等完整产物则不触发 feature。
 */
const FEATURE_PATTERNS: readonly RegExp[] = [
  /加一个.*功能/,
  /添加.*功能/,
  /实现.*功能/,
  /在.*项目.*加.*功能/,
  /在.*代码.*加.*功能/,
  /集成/,
  /接入/,
];

export function classify(
  query: string,
  hint?: 'feature' | 'project' | 'auto',
): Intent {
  if (hint && hint !== 'auto') return hint;
  // 优化 13:强信号模式优先("加功能"/"集成"/"接入" → feature)
  for (const re of FEATURE_PATTERNS) {
    if (re.test(query)) return 'feature';
  }
  const lower = query.toLowerCase();
  const projectScore = PROJECT_SIGNALS.filter(w => lower.includes(w)).length;
  const featureScore = FEATURE_SIGNALS.filter(w => lower.includes(w)).length;
  if (featureScore > projectScore) return 'feature';
  return 'project'; // ties and unknowns default to project
}
