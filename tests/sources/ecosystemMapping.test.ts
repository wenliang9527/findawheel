// tests/sources/ecosystemMapping.test.ts
import { describe, it, expect } from 'vitest';
import { ECOSYSTEM_LANG } from '../../src/sources/ecosystemMapping.js';

describe('ECOSYSTEM_LANG', () => {
  it('maps common ecosystems to language names', () => {
    expect(ECOSYSTEM_LANG['js']).toBe('JavaScript');
    expect(ECOSYSTEM_LANG['ts']).toBe('TypeScript');
    expect(ECOSYSTEM_LANG['python']).toBe('Python');
    expect(ECOSYSTEM_LANG['rust']).toBe('Rust');
    expect(ECOSYSTEM_LANG['go']).toBe('Go');
    expect(ECOSYSTEM_LANG['java']).toBe('Java');
  });

  it('includes cpp and arduino mappings', () => {
    expect(ECOSYSTEM_LANG['cpp']).toBe('C++');
    expect(ECOSYSTEM_LANG['arduino']).toBe('Arduino');
  });

  it('returns undefined for unknown ecosystems', () => {
    // 'c' 故意不映射 —— C 项目常被标记为 C/C++/Arduino,限制会漏掉主流库
    expect(ECOSYSTEM_LANG['c']).toBeUndefined();
    expect(ECOSYSTEM_LANG['unknown']).toBeUndefined();
    expect(ECOSYSTEM_LANG['']).toBeUndefined();
  });

  it('has exactly 13 ecosystems registered', () => {
    // O3:新增 csharp/php/ruby/swift/kotlin 五个语言映射,总数从 8 → 13
    const keys = Object.keys(ECOSYSTEM_LANG);
    expect(keys).toHaveLength(13);
    expect(keys.sort()).toEqual([
      'arduino', 'cpp', 'csharp', 'go', 'java', 'js',
      'kotlin', 'php', 'python', 'ruby', 'rust', 'swift', 'ts',
    ]);
  });
});
