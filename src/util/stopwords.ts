// src/util/stopwords.ts
// 基础停用词表,被 queryParser 和 searchKnowledgeTool 复用。
//
// queryParser 在此基础上扩展更多意图动词/通用技术词(见 queryParser.ts 的 QUERY_STOPWORDS)。
// searchKnowledgeTool 直接使用此基础集(知识库分词只需过滤常见虚词,不需要剔除意图动词)。
//
// 如果未来需要更细粒度的停用词控制,可在此文件导出多个分级集合。

export const BASE_STOPWORDS: ReadonlySet<string> = new Set([
  // 英文基础虚词
  'a', 'an', 'the', 'for', 'with', 'and', 'or', 'to', 'of', 'in', 'on',
  // 英文代词/常用词
  'my', 'i', 'want', 'need', 'find', 'search', 'show', 'me', 'please',
  // 中文虚词
  '的', '了', '在', '和', '与', '或', '请', '帮我', '查找', '搜索',
]);
