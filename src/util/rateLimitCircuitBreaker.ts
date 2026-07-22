// src/util/rateLimitCircuitBreaker.ts
// 进程内限流退避追踪器(rate-limit tracker):记录被限流源的恢复时间,在恢复前跳过该源,
// 避免反复触发 403/429 导致每次请求额外消耗超时。
//
// 命名说明(M13):本模块实现的是"限流退避"——基于 API 返回的 resetAt 在恢复期前跳过该源,
// 而非完整的熔断状态机(closed/open/half-open + 失败计数 + 探活)。
// 熔断针对的是内部服务调用失败率,本模块针对的是外部 API 的限流恢复时间,语义不同。
// 当前实现满足限流退避需求,按此语义使用;如需真正熔断可在后续按需扩展。
//
// 状态:进程内 Map 单例,不持久化。重启后清空(可接受:首次请求重新探测限流)。
// 线程安全:Node 单线程事件循环,Map 读写无并发竞态(无 await 夹在读写之间)。

const rateLimitedSources = new Map<string, number>(); // source -> resetAt(ms 时间戳)

/**
 * 标记某源被限流,记录恢复时间。
 * @param source 源名称(如 'github')
 * @param resetAt 恢复时间(毫秒时间戳)
 */
export function markRateLimited(source: string, resetAt: number): void {
  rateLimitedSources.set(source, resetAt);
}

/**
 * 判断某源是否仍处于限流期。已过恢复时间则自动清理并返回 false。
 */
export function isRateLimited(source: string): boolean {
  const resetAt = rateLimitedSources.get(source);
  if (resetAt === undefined) return false;
  if (Date.now() >= resetAt) {
    rateLimitedSources.delete(source);
    return false;
  }
  return true;
}

/**
 * 返回当前仍被限流的源列表(自动清理已过期的条目)。
 */
export function getRateLimitedSources(): string[] {
  const now = Date.now();
  const stillLimited: string[] = [];
  for (const [source, resetAt] of rateLimitedSources) {
    if (now >= resetAt) {
      rateLimitedSources.delete(source);
    } else {
      stillLimited.push(source);
    }
  }
  return stillLimited;
}
