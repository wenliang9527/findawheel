// src/util/hash.ts
// 短哈希工具:统一 cache key / feedback 文件名 / details key 的哈希计算。
//
// 之前 4 处各自调用 crypto.createHash('sha1').update(...).digest('hex').slice(0, 24),
// 哈希长度和算法分散在各模块,修改时需同步多处。
import * as crypto from 'node:crypto';

/** 短哈希长度(24 字符足以避免碰撞,且文件名友好) */
const SHORT_HASH_LEN = 24;

/**
 * 计算输入字符串的 sha1 短哈希(前 24 字符的 hex)。
 * 用于 cache key / feedback 文件名等需要短且唯一标识的场景。
 */
export function sha1Short(input: string): string {
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, SHORT_HASH_LEN);
}
