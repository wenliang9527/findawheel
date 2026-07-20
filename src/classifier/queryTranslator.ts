// src/classifier/queryTranslator.ts
// 把中文技术关键词翻译成英文,提升中文 query 在英文生态的命中率。
// 设计原则:
// 1. 只翻译"技术词",保留专有名词和品牌名原样
// 2. 翻译后中英合并搜索,扩大覆盖
// 3. 一个中文词可能对应多个英文词,全部加入

import { BASE_STOPWORDS } from '../util/stopwords.js';

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
  '表格': ['table', 'grid', 'datagrid'],
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

  // 算法/论文类(补 Papers with Code 盲区)
  '算法': ['algorithm'],
  '论文': ['paper', 'research'],
  '模型': ['model'],
  '训练': ['training', 'train'],
  '推理': ['inference'],
  '最新进展': ['state-of-the-art', 'sota'],

  // 嵌入式/硬件类(补嵌入式领域盲区)
  '步进电机': ['stepper-motor', 'stepper'],
  '步进': ['stepper'],
  '电机': ['motor'],
  '马达': ['motor'],
  '伺服': ['servo'],
  '舵机': ['servo'],
  '驱动': ['driver'],
  '驱动器': ['driver'],
  '驱动程序': ['driver'],
  '单片机': ['microcontroller', 'mcu', 'embedded'],
  '微控制器': ['microcontroller', 'mcu'],
  '微处理器': ['microprocessor'],
  '嵌入式': ['embedded'],
  '脉冲': ['pulse', 'pwm'],
  '加减速': ['acceleration', 'accelstepper'],
  '加速': ['acceleration'],
  '减速': ['deceleration'],
  '编码器': ['encoder'],
  '霍尔': ['hall-sensor'],
  '引脚': ['pin', 'gpio'],
  '外设': ['peripheral'],
  '中断': ['interrupt'],
  '定时器中断': ['timer-interrupt'],
  '串口': ['serial', 'uart'],
  'SPI': ['spi'],
  'I2C': ['i2c'],
  'CAN': ['can-bus'],
  // 平台名(中文 → 英文)
  '树莓派': ['raspberry-pi', 'rpi'],
  // 注:Arduino/STM32/ESP32/AVR/8051/Pico 通常用英文原名,不需翻译

  // 串口/通信类(补串口调试助手场景)
  '串口通信': ['serial-communication', 'uart'],
  '串口调试': ['serial-debug', 'serial-monitor'],
  '波特率': ['baud-rate', 'baudrate'],
  '调试': ['debug', 'debugger'],
  '调试助手': ['debug-tool', 'debugger', 'monitor'],
  '助手': ['assistant', 'tool', 'utility'],
  '监视': ['monitor', 'watch'],
  '终端': ['terminal', 'console'],
  '通信': ['communication', 'comm'],
  '收发': ['transceive', 'send-receive'],

  // 前端/数据科学/DevOps/游戏/安全领域(补多领域盲区)
  '组件库': ['component-library', 'ui-library'],
  '组件': ['component'],
  '样式': ['style', 'css'],
  '数据帧': ['dataframe'],
  '数据集': ['dataset'],
  '可视化': ['visualization'],
  '容器': ['container', 'docker'],
  '编排': ['orchestration', 'kubernetes', 'k8s'],
  '着色器': ['shader'],
  '物理引擎': ['physics-engine'],
  '碰撞': ['collision'],
  '漏洞': ['vulnerability', 'cve'],
  '渗透测试': ['pentest', 'penetration-test'],
  '逆向': ['reverse-engineering'],

  // B. 召回扩展:高频技术术语补充(2026-07-04)
  // 前端类
  '图床': ['image-hosting', 'image-upload'],
  '图标': ['icon'],
  '动画': ['animation', 'motion'],
  '图表库': ['chart-library', 'charting'],
  '表单': ['form'],
  '拖拽': ['drag', 'draggable', 'dnd'],
  '懒加载': ['lazy-load', 'lazy-loading'],
  '虚拟列表': ['virtual-list', 'virtual-scroll'],
  '状态管理': ['state-management'],
  '路由': ['router', 'routing'],
  // 数据科学类
  '张量': ['tensor'],
  '梯度': ['gradient'],
  '损失函数': ['loss-function'],
  '优化器': ['optimizer'],
  '卷积': ['convolution', 'cnn'],
  'Transformer': ['transformer'],
  '注意力': ['attention'],
  '微调': ['fine-tuning', 'fine-tune'],
  '量化': ['quantization'],
  '蒸馏': ['distillation'],
  // DevOps 类
  '持续集成': ['ci', 'continuous-integration'],
  '持续部署': ['cd', 'continuous-deployment'],
  '流水线': ['pipeline'],
  '监控告警': ['alerting', 'alert'],
  '日志收集': ['log-aggregation'],
  '服务网格': ['service-mesh'],
  '反向代理': ['reverse-proxy'],
  '负载均衡': ['load-balancer', 'load-balancing'],
  // 游戏类
  '精灵': ['sprite'],
  '贴图': ['texture'],
  '碰撞检测': ['collision-detection'],
  '寻路': ['pathfinding'],
  '相机': ['camera'],
  // 安全类
  '加密算法': ['encryption-algorithm', 'cipher'],
  '哈希': ['hash', 'hashing'],
  '签名': ['signature'],
  '证书': ['certificate', 'cert', 'tls'],
  '防火墙': ['firewall'],
  '沙箱': ['sandbox'],
  '注入': ['injection'],
  // 通用工具类
  '脚手架': ['scaffold', 'boilerplate'],
  '模板引擎': ['template-engine'],
  'ORM': ['orm', 'object-relational-mapping'],
  '推送': ['push', 'notification'],
  '搜索': ['search', 'search-engine'],
  '推荐': ['recommend', 'recommendation'],
  // AI/LLM 类(高频)
  '大模型': ['llm', 'large-language-model'],
  '提示词': ['prompt'],
  '向量数据库': ['vector-database', 'vector-db'],
  '嵌入': ['embedding'],
  '检索增强': ['rag', 'retrieval-augmented'],
  '智能体': ['agent'],
  '对话': ['chat', 'dialog', 'conversation'],
  '语音识别': ['speech-recognition', 'asr'],
  '语音合成': ['speech-synthesis', 'tts'],
  'OCR': ['ocr', 'text-recognition'],
  '翻译': ['translate', 'translation'],
  // 网络/通信类
  'WebSocket': ['websocket', 'ws'],
  'HTTP': ['http'],
  'RPC': ['rpc'],
  'GraphQL': ['graphql'],
  'REST': ['rest', 'restful'],
  // 存储/数据库类
  '关系数据库': ['sql', 'relational-database'],
  '键值存储': ['key-value-store', 'kv-store'],
  '文档数据库': ['document-database'],
  '图数据库': ['graph-database'],
  '时序数据库': ['time-series-database'],

  // Q5:继续扩展 —— 实战中常见但尚未覆盖的术语
  // 协议/通信类
  '串行': ['serial'],
  '并行': ['parallel'],
  '异步': ['async', 'asynchronous'],
  '同步': ['sync', 'synchronous'],
  '协议': ['protocol'],
  '消息队列': ['message-queue', 'mq'],
  '发布订阅': ['pubsub', 'publish-subscribe'],
  // 工具/工程类
  '打包': ['bundler', 'bundle', 'webpack'],
  '部署': ['deploy', 'deployment'],
  '测试': ['test', 'testing', 'unit-test'],
  '断言': ['assert', 'assertion'],
  '模拟': ['mock', 'fake', 'stub'],
  '覆盖率': ['coverage'],
  // 安全/加密类
  '鉴权': ['auth', 'authentication'],
  '授权': ['authorization', 'authz'],
  '令牌': ['token', 'jwt'],
  // 数据处理类
  '清洗': ['clean', 'cleaning', 'preprocess'],
  '标注': ['annotate', 'annotation', 'label'],
  '特征': ['feature'],
  '降维': ['dimensionality-reduction', 'pca'],
  '聚类': ['clustering', 'cluster'],
  '分类': ['classification', 'classifier'],
  '回归': ['regression'],
  '检测': ['detection', 'detector'],
  '分割': ['segmentation', 'segment'],
  '识别': ['recognition', 'recognize'],
  // 部署/运维类
  '镜像': ['image', 'container-image'],
  '配置': ['config', 'configuration'],
  '环境变量': ['env', 'environment-variable'],
  // 前端补充
  '响应式': ['responsive', 'reactive'],
  '服务端渲染': ['ssr', 'server-side-rendering'],
  '静态站点': ['static-site', 'ssg'],
  // 通用概念
  '中间件': ['middleware'],
  '微服务': ['microservice', 'microservices'],
  '分布式': ['distributed'],
  '高可用': ['high-availability', 'ha'],
  '负载': ['load'],
  '限流': ['rate-limit', 'throttle'],
  '熔断': ['circuit-breaker'],
  '重试': ['retry'],
  '降级': ['degrade', 'fallback'],

  // C. 补漏:常见技术词(2026-07-20)
  // 修复 issue:用户输入"我想做一个实时监控电脑状态的可爱宠物"时,suggest_queries
  // 4 个变体全是中文原文。根因是 ZH_TO_EN 表里有"监视"/"监控告警"却没有独立的
  // "监控",以及"实时"/"状态"/"电脑"等常见技术词完全缺失,导致整段中文未翻译。
  // 这里补全实战高频但前面 5 段遗漏的常见技术词。
  '监控': ['monitor', 'monitoring'],
  '实时': ['realtime', 'real-time'],
  '状态': ['status', 'state'],
  '电脑': ['computer'],
  '桌面': ['desktop'],
  '程序': ['program', 'application'],
  '软件': ['software'],
  '硬件': ['hardware'],
  '网络': ['network'],
  '浏览器': ['browser'],
  '服务器': ['server'],
  '客户端': ['client'],
  '游戏': ['game'],
  '小工具': ['widget', 'gadget'],
  '可爱': ['cute'],
  '宠物': ['pet'],
};

/**
 * 在 query 中查找所有命中的中文/英文大写关键词,按最长匹配优先。
 *
 * 解决三个问题:
 * 1. 大小写不敏感:翻译表里的英文大写词条(SPI/I2C/HTTP 等)能匹配小写输入
 * 2. 最长匹配优先:"数据库"命中后,"库"在其范围内不再重复匹配(避免噪声)
 * 3. 不破坏相邻词条:"图片水印"应同时命中"图片"和"水印"(二者不重叠)
 *
 * 实现:按 key 长度降序遍历,维护 consumed 数组标记 query 中已被消费的字符位置,
 * 后续 key 只在未消费字符范围内查找匹配,避免短词在已匹配长词范围内再次命中。
 */
function findZhMappings(query: string): Map<string, string[]> {
  const queryLower = query.toLowerCase();
  const consumed = new Array<boolean>(query.length).fill(false);
  const entries = Object.entries(ZH_TO_EN)
    .map(([zh, enList]) => ({ zh, zhLower: zh.toLowerCase(), enList }))
    .sort((a, b) => b.zh.length - a.zh.length);
  const result = new Map<string, string[]>();
  for (const { zh, zhLower, enList } of entries) {
    let idx = 0;
    while (idx <= queryLower.length - zhLower.length) {
      // 在未消费区域查找 zhLower 的出现位置
      let matchStart = -1;
      for (let i = idx; i <= queryLower.length - zhLower.length; i++) {
        let ok = true;
        for (let j = 0; j < zhLower.length; j++) {
          if (consumed[i + j] || queryLower[i + j] !== zhLower[j]) {
            ok = false;
            break;
          }
        }
        if (ok) {
          matchStart = i;
          break;
        }
      }
      if (matchStart === -1) break;
      for (let i = matchStart; i < matchStart + zhLower.length; i++) consumed[i] = true;
      if (!result.has(zh)) result.set(zh, enList);
      idx = matchStart + zhLower.length;
    }
  }
  return result;
}

/**
 * 意图前缀正则:剥离后让 translateQuery 能更专注于实词翻译。
 *
 * 场景:用户常输入"我想做一个 X"/"帮我写一个 Y"等自然语言句子,
 * parseQuery 按空格拆词时整段中文(无空格)会被当作 1 个 token,
 * 导致 suggestions 4 个变体全是同一串中文。
 * 剥离意图前缀后,中文 token 缩短,降低噪声,翻译英文词仍能命中。
 *
 * 排序:长前缀在前(配合 break 只剥离一次,避免短前缀先匹配留下残字)。
 * 只在 query 开头匹配(^),不破坏内部实词。
 */
const INTENT_PREFIXES: readonly RegExp[] = [
  // 优化 14:扩展编程场景前缀(加功能/添加/实现/集成/接入)。
  // 长前缀优先(配合 break 只剥离一次,避免短前缀先匹配留下残字)。
  // 7 字符:"我想在项目里加"/"我想在代码里加"
  /^我想在项目里加[\s]*/,
  /^我想在代码里加[\s]*/,
  // 6 字符通配:兜底匹配"我想在 X 里加"(如"我想在工程里加"/"我想在仓库里加")
  // 放在具体模式之后,具体模式优先命中
  /^我想在.*里加[\s]*/,
  // 5 字符
  /^我想做一个[\s]*/,
  /^我想要一个[\s]*/,
  /^帮我写一个[\s]*/,
  /^帮我做一个[\s]*/,
  /^我想加一个[\s]*/,
  /^帮我加一个[\s]*/,
  // 4 字符
  /^请帮我写[\s]*/,
  /^请帮我做[\s]*/,
  /^如何实现[\s]*/,
  /^想要一个[\s]*/,
  /^请帮我加[\s]*/,
  /^我想实现[\s]*/,
  /^帮我实现[\s]*/,
  /^我想集成[\s]*/,
  /^帮我集成[\s]*/,
  /^我想接入[\s]*/,
  /^帮我添加[\s]*/,
  // 3 字符
  /^我想做[\s]*/,
  /^我想要[\s]*/,
  /^我需要[\s]*/,
  /^帮我写[\s]*/,
  /^帮我做[\s]*/,
  /^请帮我[\s]*/,
  // 2 字符
  /^如何[\s]*/,
  /^帮我[\s]*/,
  /^请帮[\s]*/,
  /^想要[\s]*/,
];

function stripIntentPrefix(query: string): string {
  for (const re of INTENT_PREFIXES) {
    if (re.test(query)) {
      return query.replace(re, '').trim();
    }
  }
  return query.trim();
}

/**
 * 兜底翻译映射:只在 ZH_TO_EN 完全未命中时启用。
 *
 * 设计动机:ZH_TO_EN 的 200+ 词映射表不可能覆盖所有中文,
 * 当用户输入以非技术词为主的 query(如"我想做一个可爱宠物")时,
 * 主表完全未命中,此时启用兜底做简单逐词替换,至少能剥离意图前缀
 * 并保留有意义的实词,让英文搜索词变体不至于全是中文原文。
 *
 * 与 ZH_TO_EN 的区别:
 * - ZH_TO_EN 收录技术词,保留原中文并追加英文
 * - FALLBACK_ZH_EN 收录意图前缀(替换为空)+ 助词(替换为空格),做替换式翻译
 *
 * 注意:不加 ZH_TO_EN 已覆盖的技术词,避免重复维护。
 */
const FALLBACK_ZH_EN: ReadonlyArray<readonly [RegExp, string]> = [
  // 意图前缀:剥离(替换为空)
  [/我想做一个/g, ''],
  [/我想要一个/g, ''],
  [/帮我写一个/g, ''],
  [/帮我做一个/g, ''],
  [/如何实现/g, ''],
  [/我想做/g, ''],
  [/我想要/g, ''],
  [/我需要/g, ''],
  [/帮我写/g, ''],
  [/帮我做/g, ''],
  [/请帮我/g, ''],
  [/帮我/g, ''],
  [/如何/g, ''],
  [/想要/g, ''],
  // 助词/量词:替换为空格,让中文实词能被空格分割
  [/一个/g, ' '],
  [/的/g, ' '],
];

function applyFallback(query: string): string {
  let result = query;
  for (const [re, en] of FALLBACK_ZH_EN) {
    result = result.replace(re, en);
  }
  return result.trim().replace(/\s+/g, ' ');
}

/**
 * 优化15:句式翻译 —— 把 "X转成Y" / "X转Y" / "X转换Y" / "X转换为Y" / "把X变成Y"
 * 翻译成英文 "X to Y" 句式,覆盖中文描述转换场景的常见说法。
 *
 * 场景:用户搜 "HTML转成PDF" 时,只做词级翻译会得到 "HTML 转成 PDF",
 * 没有产生 "to" 句式,英文生态(GitHub/Stack Overflow)里 "html to pdf" 才是高频说法。
 *
 * 实现:\w 只匹配 [A-Za-z0-9_],所以 X/Y 限定为英文/数字技术词
 * (如 HTML/PDF/JSON/CSV),不处理中文 X/Y(避免与 ZH_TO_EN 词级翻译冲突)。
 *
 * 顺序:更具体的(转换为/转换/转成)在前,最宽泛的(转)最后,
 * 避免短模式先匹配导致长模式失配。
 */
function translateConversionPatterns(text: string): string {
  return text
    .replace(/(\w+)\s*转换为\s*(\w+)/g, '$1 to $2')
    .replace(/(\w+)\s*转换\s*(\w+)/g, '$1 to $2')
    .replace(/(\w+)\s*转成\s*(\w+)/g, '$1 to $2')
    .replace(/(\w+)\s*转\s*(\w+)/g, '$1 to $2')
    .replace(/把\s*(\w+)\s*变成\s*(\w+)/g, '$1 to $2');
}

/**
 * 把 query 中的中文关键词翻译成英文,与原 query 合并。
 * 保留原中文(用于命中中文 README 的仓库),追加英文(扩大覆盖)。
 *
 * 修复(2026-07-20):加意图前缀剥离 + 兜底翻译分支,解决"用户输入自然语言
 * 句子时 suggest_queries 4 个变体全是中文原文"的问题。
 * - 主分支:ZH_TO_EN 命中 → 返回 stripped + 英文(stripped 已剥离意图前缀)
 * - 兜底分支:ZH_TO_EN 完全未命中 → 用 FALLBACK_ZH_EN 做替换式翻译
 * - 都失败:返回原文(不破坏下游)
 *
 * @example
 * translateQuery('图片水印') // '图片水印 image watermark'
 * translateQuery('markdown 解析') // 'markdown 解析 parser'
 * translateQuery('我想做一个实时监控电脑状态的可爱宠物')
 *   // '实时监控电脑状态的可爱宠物 realtime real-time monitor monitoring computer status state'
 */
export function translateQuery(query: string): string {
  // 1. 剥离意图前缀("我想做一个 X" → "X"),降低噪声
  let stripped = stripIntentPrefix(query);
  // 1.5 优化15:句式翻译 "X转成Y" → "X to Y"(覆盖英文技术词之间的中文转换表述)
  stripped = translateConversionPatterns(stripped);
  // 2. 在 stripped 上做映射表翻译
  const mappings = findZhMappings(stripped);
  const enWords = new Set<string>();
  for (const enList of mappings.values()) {
    for (const en of enList) enWords.add(en);
  }
  // 3. 主分支:有翻译 → 返回 stripped + 英文(stripped 已去掉意图前缀,但保留命中词的中文原文)
  if (enWords.size > 0) {
    return `${stripped} ${[...enWords].join(' ')}`;
  }
  // 4. 兜底分支:ZH_TO_EN 完全未命中,做通用词替换(剥离意图前缀 + 替换助词)
  const fallback = applyFallback(stripped);
  // 兜底也无效(用户输入全是意图前缀)则返回原文(保留原 query 不破坏下游)
  return fallback || query;
}

/**
 * 提取 query 中的核心英文关键词,用于评分时检查 description 是否包含。
 * 用于在 Ranker 里给"描述命中 query 核心词"的项目加分。
 */
export function extractKeywords(query: string): string[] {
  // P1-6:复用 BASE_STOPWORDS(避免与 queryParser/stopwords.ts 三处重复维护)
  const words = query
    .toLowerCase()
    .split(/[\s,，。、;；!！?？]+/)
    .filter(w => w.length > 1 && !BASE_STOPWORDS.has(w));

  // 把中文翻译后也加入关键词集(与 translateQuery 共用最长匹配逻辑)
  const enWords = new Set<string>(words);
  const mappings = findZhMappings(query);
  for (const enList of mappings.values()) {
    for (const en of enList) enWords.add(en);
  }
  return [...enWords];
}
