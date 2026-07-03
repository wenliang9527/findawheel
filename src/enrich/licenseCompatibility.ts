// src/enrich/licenseCompatibility.ts
export interface LicenseCheck {
  /** true=可安全使用, false=不兼容, null=无法判断(未知 license) */
  compatible: boolean | null;
  /** 人类可读说明 */
  note: string;
}

/** 归一化映射：小写变体 → 标准名 */
const NORMALIZE_MAP: Record<string, string> = {
  // MIT
  mit: 'MIT',
  'mit license': 'MIT',
  // Apache-2.0
  'apache-2.0': 'Apache-2.0',
  'apache 2.0': 'Apache-2.0',
  apache: 'Apache-2.0',
  'apache license 2.0': 'Apache-2.0',
  'apache license, version 2.0': 'Apache-2.0',
  // GPL-2.0
  'gpl-2.0': 'GPL-2.0',
  gplv2: 'GPL-2.0',
  'gnu general public license v2.0': 'GPL-2.0',
  'gnu general public license v2': 'GPL-2.0',
  'gpl-2.0-only': 'GPL-2.0',
  'gpl-2.0-or-later': 'GPL-2.0',
  // GPL-3.0
  'gpl-3.0': 'GPL-3.0',
  gplv3: 'GPL-3.0',
  'gnu general public license v3.0': 'GPL-3.0',
  'gnu general public license v3': 'GPL-3.0',
  'gpl-3.0-only': 'GPL-3.0',
  'gpl-3.0-or-later': 'GPL-3.0',
  // BSD
  bsd: 'BSD',
  'bsd-2-clause': 'BSD',
  'bsd-3-clause': 'BSD',
  'bsd license': 'BSD',
  // LGPL
  lgpl: 'LGPL',
  'lgpl-2.1': 'LGPL',
  'lgpl-3.0': 'LGPL',
  'gnu lesser general public license': 'LGPL',
  // ISC
  isc: 'ISC',
  'isc license': 'ISC',
  // Unlicense / CC0 / Public Domain
  unlicense: 'Unlicense',
  cc0: 'Unlicense',
  'public domain': 'Unlicense',
  'cc0 1.0': 'Unlicense',
};

/** 宽松 license：可被任意 user license 使用而不传染 */
const PERMISSIVE = new Set(['MIT', 'BSD', 'ISC', 'Unlicense', 'LGPL']);

/** 已知的所有标准 license 名 */
const KNOWN_LICENSES = new Set([
  'MIT',
  'Apache-2.0',
  'GPL-2.0',
  'GPL-3.0',
  'BSD',
  'LGPL',
  'ISC',
  'Unlicense',
]);

/**
 * 将输入的 license 字符串归一化为标准名。
 * 大小写不敏感，处理常见变体。未知 license 返回 trim 后的原值。
 */
function normalizeLicense(raw: string): string {
  const key = raw.trim().toLowerCase();
  return NORMALIZE_MAP[key] ?? raw.trim();
}

/**
 * 检查 wheel 的 license 是否可被 user 项目使用（不迫使 user 项目改变 license）。
 * 语义：user 项目 license 为 X，wheel license 为 Y，Y 能否被 X 项目使用而不传染。
 *
 * 兼容性规则：
 * - wheel 是宽松 license（MIT/BSD/ISC/Unlicense/LGPL）→ 任意 user 都能用 → true
 * - wheel 是 Apache-2.0 → user 是 GPL-2.0 时 false，其他 true
 * - wheel 是 GPL-2.0 → user 是 GPL-2.0 时 true，其他 false
 * - wheel 是 GPL-3.0 → user 是 GPL-3.0 时 true，其他 false
 * - wheel 或 user 为 undefined/null/空 → null（无法判断）
 * - 未知 license → null
 */
export function checkLicenseCompatibility(
  wheelLicense: string | undefined,
  userLicense: string | undefined,
): LicenseCheck {
  // 缺失（undefined/null/空字符串）→ 无法判断
  if (!wheelLicense || !userLicense) {
    return { compatible: null, note: 'license unknown' };
  }

  const wheelNorm = normalizeLicense(wheelLicense);
  const userNorm = normalizeLicense(userLicense);

  // wheel license 未知 → 无法判断
  if (!KNOWN_LICENSES.has(wheelNorm)) {
    return {
      compatible: null,
      note: `unknown license: ${wheelLicense}`,
    };
  }

  // user license 未知 → 无法判断（除非 wheel 是宽松 license，可被任意 user 使用）
  if (!KNOWN_LICENSES.has(userNorm)) {
    if (PERMISSIVE.has(wheelNorm)) {
      return {
        compatible: true,
        note: `${wheelNorm} is compatible with ${userLicense}`,
      };
    }
    return {
      compatible: null,
      note: `unknown license: ${userLicense}`,
    };
  }

  // 宽松 wheel → 任意 user 都能用
  if (PERMISSIVE.has(wheelNorm)) {
    return {
      compatible: true,
      note: `${wheelNorm} is compatible with ${userNorm}`,
    };
  }

  // Apache-2.0 wheel：仅与 GPL-2.0 user 不兼容
  if (wheelNorm === 'Apache-2.0') {
    const compatible = userNorm !== 'GPL-2.0';
    return {
      compatible,
      note: compatible
        ? `${wheelNorm} is compatible with ${userNorm}`
        : `${wheelNorm} is not compatible with ${userNorm}`,
    };
  }

  // GPL-2.0 wheel：仅与 GPL-2.0 user 兼容
  if (wheelNorm === 'GPL-2.0') {
    const compatible = userNorm === 'GPL-2.0';
    return {
      compatible,
      note: compatible
        ? `${wheelNorm} is compatible with ${userNorm}`
        : `${wheelNorm} is not compatible with ${userNorm}`,
    };
  }

  // GPL-3.0 wheel：仅与 GPL-3.0 user 兼容
  if (wheelNorm === 'GPL-3.0') {
    const compatible = userNorm === 'GPL-3.0';
    return {
      compatible,
      note: compatible
        ? `${wheelNorm} is compatible with ${userNorm}`
        : `${wheelNorm} is not compatible with ${userNorm}`,
    };
  }

  // 理论上不会到达，保险兜底
  return { compatible: null, note: 'license unknown' };
}
