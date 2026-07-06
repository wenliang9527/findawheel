// src/util/time.ts
// 时间常量集中定义(P1-8)。
//
// 之前 ranker.ts 和 recommender.ts 各自定义 ONE_YEAR_MS / THREE_YEARS_MS,
// 数值分散在多处容易不一致。现集中导出,所有 rank 模块复用。

/** 1 天的毫秒数 */
export const MS_PER_DAY = 24 * 3600 * 1000;
/** 1 年的毫秒数(按 365 天计) */
export const ONE_YEAR_MS = 365 * MS_PER_DAY;
/** 3 年的毫秒数 */
export const THREE_YEARS_MS = 3 * ONE_YEAR_MS;
/** 6 个月(180 天)的毫秒数,用于 metricsEnricher.inferActivity 的 high 阈值 */
export const SIX_MONTHS_MS = 180 * MS_PER_DAY;
/** 2 年(730 天)的毫秒数,用于 metricsEnricher.inferActivity 的 medium 阈值 */
export const TWO_YEARS_MS = 730 * MS_PER_DAY;
