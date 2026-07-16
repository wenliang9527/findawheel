export function topicMatches(topic: string, keyword: string): boolean {
  if (keyword.length <= 3) {
    return topic === keyword
      || topic.startsWith(keyword + '-')
      || topic.endsWith('-' + keyword)
      || topic.includes('-' + keyword + '-');
  }
  return topic.includes(keyword) || keyword.includes(topic);
}

// 短关键词 RegExp 编译缓存:ranker 评分热路径单次搜索约 2000 次构造,
// 缓存编译后的 RegExp 避免重复 new RegExp 开销(20-100ms)。
const shortKeywordRegexCache = new Map<string, RegExp>();

export function matchesKeyword(textLower: string, keyword: string): boolean {
  if (keyword.length <= 3) {
    let re = shortKeywordRegexCache.get(keyword);
    if (!re) {
      re = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      shortKeywordRegexCache.set(keyword, re);
    }
    return re.test(textLower);
  }
  return textLower.includes(keyword);
}
