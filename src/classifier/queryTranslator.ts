// src/classifier/queryTranslator.ts
// 把中文技术关键词翻译成英文,提升中文 query 在英文生态的命中率。
// 设计原则:
// 1. 只翻译"技术词",保留专有名词和品牌名原样
// 2. 翻译后中英合并搜索,扩大覆盖
// 3. 一个中文词可能对应多个英文词,全部加入

const ZH_TO_EN: Record<string, string[]> = {
  // 动作类
  '解析': ['parse', 'parser'],
  '转换': ['convert', 'conversion'],
  '生成': ['generate', 'generator'],
  '压缩': ['compress', 'compression'],
  '加密': ['encrypt', 'encryption'],
  '解密': ['decrypt', 'decryption'],
  '验证': ['validate', 'validation'],
  '上传': ['upload', 'uploader'],
  '下载': ['download', 'downloader'],
  '截图': ['screenshot'],
  '水印': ['watermark'],
  '编辑器': ['editor'],
  '播放器': ['player'],
  '渲染器': ['renderer'],
  '编译器': ['compiler'],
  '爬虫': ['crawler', 'scraper'],
  '轮询': ['polling'],
  '缓存': ['cache', 'caching'],

  // 代码片段类(补 GitHub Code Search 盲区)
  '实现': ['implementation', 'implement'],
  '函数': ['function'],
  '代码': ['code', 'snippet'],
  '片段': ['snippet', 'fragment'],
  '示例': ['example', 'sample'],
  '源码': ['source', 'source-code'],
  '用法': ['usage', 'example'],

  // 对象类
  '图片': ['image'],
  '视频': ['video'],
  '音频': ['audio'],
  '文件': ['file'],
  '数据库': ['database', 'db'],
  '表格': ['table', 'grid'],
  '图表': ['chart', 'charting'],
  '二维码': ['qrcode', 'qr-code'],
  '条形码': ['barcode'],
  '验证码': ['captcha'],
  '命令行': ['cli', 'command-line'],
  '日志': ['log', 'logging'],
  '定时器': ['timer', 'scheduler'],
  '队列': ['queue'],
  '模板': ['template'],

  // 应用类
  '笔记': ['note', 'notes'],
  '博客': ['blog'],
  '论坛': ['forum'],
  '聊天': ['chat'],
  '支付': ['payment'],
  '登录': ['login', 'auth'],
  '权限': ['permission', 'auth'],
  '菜单': ['menu', 'navbar'],
  '轮播': ['carousel', 'slider'],

  // 系统类
  '系统': ['system'],
  '平台': ['platform'],
  '框架': ['framework'],
  '库': ['library', 'lib'],
  '插件': ['plugin', 'extension', 'vscode'],
  '扩展': ['extension', 'plugin'],
  '工具': ['tool', 'toolkit'],
  '应用': ['app', 'application'],
  '网站': ['website', 'site'],
  '后台': ['admin', 'dashboard', 'backend'],
  '前端': ['frontend'],
  '后端': ['backend'],
  '全栈': ['fullstack'],

  // 技术栈
  '机器学习': ['machine-learning', 'ml'],
  '深度学习': ['deep-learning'],
  '神经网络': ['neural-network'],
  '自然语言处理': ['nlp'],
  '计算机视觉': ['computer-vision', 'cv'],
};

/**
 * 把 query 中的中文关键词翻译成英文,与原 query 合并。
 * 保留原中文(用于命中中文 README 的仓库),追加英文(扩大覆盖)。
 *
 * @example
 * translateQuery('图片水印') // '图片水印 image watermark'
 * translateQuery('markdown 解析') // 'markdown 解析 parser'
 */
export function translateQuery(query: string): string {
  const enWords = new Set<string>();
  for (const [zh, enList] of Object.entries(ZH_TO_EN)) {
    if (query.includes(zh)) {
      for (const en of enList) enWords.add(en);
    }
  }
  if (enWords.size === 0) return query;
  return `${query} ${[...enWords].join(' ')}`;
}

/**
 * 提取 query 中的核心英文关键词,用于评分时检查 description 是否包含。
 * 用于在 Ranker 里给"描述命中 query 核心词"的项目加分。
 */
export function extractKeywords(query: string): string[] {
  // 去掉常见停用词,保留实质词
  const stopwords = new Set(['a', 'an', 'the', 'for', 'with', 'and', 'or', 'to', 'of', 'in', 'on', 'my', 'i', 'want']);
  const words = query
    .toLowerCase()
    .split(/[\s,，。、;；!！?？]+/)
    .filter(w => w.length > 1 && !stopwords.has(w));

  // 把中文翻译后也加入关键词集
  const enWords = new Set<string>(words);
  for (const [zh, enList] of Object.entries(ZH_TO_EN)) {
    if (query.includes(zh)) {
      for (const en of enList) enWords.add(en);
    }
  }
  return [...enWords];
}
