// src/classifier/queryClassifier.ts
import type { Intent } from '../normalize/types.js';

const PROJECT_SIGNALS = [
  'app', 'application', 'platform', 'tool', 'editor', 'dashboard',
  '系统', '平台', '应用', '编辑器', '网站', '管理系统',
];

const FEATURE_SIGNALS = [
  'parse', 'convert', 'generate', 'compress', 'encrypt',
  'client', 'sdk', 'wrapper',
  '解析', '转换', '压缩', '加密', '客户端',
  // 硬件/嵌入式类(嵌入式领域 query 通常找驱动库/功能,而非完整项目)
  'driver', 'drive', 'control', 'controller', 'stepper', 'motor', 'servo',
  'pwm', 'pulse', 'encoder', 'hal',
  '驱动', '驱动器', '电机', '马达', '舵机', '脉冲', '编码器',
];

export function classify(
  query: string,
  hint?: 'feature' | 'project' | 'auto',
): Intent {
  if (hint && hint !== 'auto') return hint;
  const lower = query.toLowerCase();
  const projectScore = PROJECT_SIGNALS.filter(w => lower.includes(w)).length;
  const featureScore = FEATURE_SIGNALS.filter(w => lower.includes(w)).length;
  if (featureScore > projectScore) return 'feature';
  return 'project'; // ties and unknowns default to project
}
