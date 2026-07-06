// src/sources/knowledgeSourceAdapter.ts
// 个人知识库搜索适配器(本地 Markdown 文件夹)。
//
// 设计:
// 1. 多根支持(FINDAWHEEL_KB_ROOT 逗号分隔多个路径)
// 2. 扫描 .md 文件,提取标题/路径/snippet/tags
// 3. 标签来源:
//    a. YAML frontmatter 的 tags / categories 字段
//    b. frontmatter 的 aliases 字段(Obsidian 别名,也作为可搜索标签)
//    c. 正文 inline #tag(排除 ## 标题语法)
//    d. 正文 [[wiki-link]] 双向链接 → 提取为 tags(提升召回)
// 4. 智能识别知识库类型(Obsidian/Logseq/思源/普通),只读不写,无副作用
// 5. 缓存可选(FINDAWHEEL_KB_CACHE_ENABLED,默认 false 每次扫描保证最新)
// 6. 单文件大小上限(FINDAWHEEL_KB_MAX_FILE_KB,默认 100KB)
//
// 搜索字段优先级:title > path > tag > content
// 不做全文搜索/向量检索,保持零依赖和与"不调 LLM"约束一致。
//
// 与专用 MCP 服务器(如 obsidian-mcp)的共存策略:
// - 本工具只读、零依赖、即装即用、支持任意 .md 文件夹
// - 专用 MCP 需目标软件运行 + 插件 + token,但支持写操作/全文搜索/向量检索
// - 两者可同时配置,findawheel 负责轻量快速搜索,专用 MCP 处理深度集成

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { logError, logWarn } from '../util/logger.js';

/**
 * 正则预编译(模块级常量,避免每个文件解析时重新编译)。
 * 注意:带 g 标志的正则有 lastIndex 状态,在 exec 循环前需手动重置 lastIndex=0。
 */
// 匹配 #tag(后面跟非字母数字或行尾,前面是空格或行首),排除 ## ### 等 markdown 标题(# 后跟空格)
const TAG_REGEX = /(?:^|\s)#([a-z][a-z0-9_-]*)/gi;
// 提取 [[wiki-link]] 双向链接 → note-name(丢弃 alias/heading/block-id)
const WIKI_LINK_REGEX = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
// hex 颜色过滤(#FF0000 / #abc 等 3 或 6 位纯十六进制)
const HEX_COLOR_REGEX = /^[0-9a-f]{3}$|^[0-9a-f]{6}$/;

/** 知识库类型(自动识别) */
export type KbType = 'obsidian' | 'logseq' | 'siyuan' | 'plain';

export interface KnowledgeItem {
  /** 文档标题(第一行 H1 或文件名不含扩展名) */
  title: string;
  /** 相对知识库根目录的路径(如 "projects/findawheel/architecture.md") */
  relativePath: string;
  /** 绝对路径,用于 AI 客户端读取 */
  absolutePath: string;
  /** file:// URL,AI 可直接打开 */
  url: string;
  /** 正文摘要(前 500 字符,去掉 frontmatter) */
  snippet: string;
  /** 从 frontmatter 和 inline #tag 和 [[wiki-link]] 提取的标签 */
  tags: string[];
  /** 文件最后修改时间(ISO date) */
  lastUpdated?: string;
  /** 命中字段,帮 AI 判断相关性 */
  matchedField: 'title' | 'path' | 'tag' | 'content';
  /** 所属知识库根目录(用于多根场景区分来源) */
  kbRoot: string;
  /** 知识库类型(自动识别) */
  kbType: KbType;
}

export interface KnowledgeSearchOpts {
  /** 搜索关键词列表(已分词) */
  keywords: string[];
  /** 返回结果上限 */
  limit?: number;
  /** 单文件大小上限(KB) */
  maxFileKb: number;
}

interface ParsedMarkdown {
  title: string;
  frontmatterTags: string[];
  inlineTags: string[];
  wikiLinkTags: string[];
  bodyWithoutFrontmatter: string;
}

/**
 * 识别知识库类型(通过目录结构特征)。
 *
 * Obsidian: 顶层有 .obsidian/ 配置目录
 * Logseq:  顶层有 logseq/ 配置目录,且包含 pages/ 和 journals/
 * 思源:    顶层有 conf/ 和 data/ 目录,data/ 下有 notebooks/
 * plain:   普通 .md 文件夹,无特定结构
 *
 * 检测只读目录,不写入任何文件,无副作用。
 */
async function detectKbType(rootDir: string): Promise<KbType> {
  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    const dirs = new Set(entries.filter(e => e.isDirectory()).map(e => e.name));

    // Obsidian: 有 .obsidian/ 配置目录(虽然扫描时跳过隐藏目录,但此处检测根目录)
    if (entries.some(e => e.isDirectory() && e.name === '.obsidian')) {
      return 'obsidian';
    }
    // Logseq: 有 logseq/ 目录 + (pages/ 或 journals/)
    if (dirs.has('logseq') && (dirs.has('pages') || dirs.has('journals'))) {
      return 'logseq';
    }
    // 思源笔记: 有 conf/ + data/ 目录
    if (dirs.has('conf') && dirs.has('data')) {
      return 'siyuan';
    }
    // Logseq 也可能没 logseq/ 目录,但通常有 pages/journals
    if (dirs.has('pages') && dirs.has('journals')) {
      return 'logseq';
    }
    return 'plain';
  } catch (err) {
    logError('KB type detect failed', err);
    return 'plain';
  }
}

/** 解析 Markdown 文件,提取标题/标签/正文 */
function parseMarkdown(content: string, fileName: string): ParsedMarkdown {
  let body = content;
  const frontmatterTags: string[] = [];

  // 1. 提取 YAML frontmatter(--- ... ---)
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (fmMatch) {
    const fm = fmMatch[1];
    body = content.slice(fmMatch[0].length);

    // 提取 frontmatter 的 tags: / categories: 字段
    // 支持 tags: [a, b, c] / tags:\n  - a\n  - b / categories: xxx
    const tagsLine = fm.match(/^tags:\s*\[(.+?)\]\s*$/m);
    if (tagsLine) {
      tagsLine[1].split(',').forEach(t => {
        const cleaned = t.trim().replace(/^["']|["']$/g, '');
        if (cleaned) frontmatterTags.push(cleaned);
      });
    } else {
      // 多行格式:tags:\n  - a\n  - b
      const tagsBlock = fm.match(/^tags:\s*\n((?:\s+-\s+.+\n?)+)/m);
      if (tagsBlock) {
        tagsBlock[1].split('\n').forEach(line => {
          const m = line.match(/^\s+-\s+(.+?)\s*$/);
          if (m) frontmatterTags.push(m[1].replace(/^["']|["']$/g, ''));
        });
      }
    }
    // categories: 字段也作为标签
    const catLine = fm.match(/^categories:\s*\[(.+?)\]\s*$/m);
    if (catLine) {
      catLine[1].split(',').forEach(t => {
        const cleaned = t.trim().replace(/^["']|["']$/g, '');
        if (cleaned) frontmatterTags.push(cleaned);
      });
    }
    // aliases: 字段(Obsidian 别名,也作为可搜索标签)
    // 支持 aliases: [name1, name2] / aliases:\n  - name1\n  - name2
    const aliasLine = fm.match(/^aliases:\s*\[(.+?)\]\s*$/m);
    if (aliasLine) {
      aliasLine[1].split(',').forEach(t => {
        const cleaned = t.trim().replace(/^["']|["']$/g, '');
        if (cleaned) frontmatterTags.push(cleaned);
      });
    } else {
      const aliasBlock = fm.match(/^aliases:\s*\n((?:\s+-\s+.+\n?)+)/m);
      if (aliasBlock) {
        aliasBlock[1].split('\n').forEach(line => {
          const m = line.match(/^\s+-\s+(.+?)\s*$/);
          if (m) frontmatterTags.push(m[1].replace(/^["']|["']$/g, ''));
        });
      }
    }
  }

  // 2. 提取标题:第一行 H1,或文件名
  let title = fileName.replace(/\.md$/i, '');
  const h1Match = body.match(/^#\s+(.+?)\s*$/m);
  if (h1Match) {
    title = h1Match[1].trim();
  }

  // 3. 提取 inline #tag(正文里的 #tag 形式,排除 # 标题语法)
  const inlineTags = new Set<string>();
  // 重置 lastIndex(g 标志正则有状态,复用前必须重置)
  TAG_REGEX.lastIndex = 0;
  let tagMatch;
  while ((tagMatch = TAG_REGEX.exec(body)) !== null) {
    const tag = tagMatch[1].toLowerCase();
    // 排除 hex 颜色(#FF0000 / #abc 等 3 或 6 位纯十六进制)
    // (i 标志使 [a-z] 也匹配大写,故 #FF0000 会被捕获为 ff0000,需后过滤)
    if (HEX_COLOR_REGEX.test(tag)) continue;
    inlineTags.add(tag);
  }

  // 4. 提取 [[wiki-link]] 双向链接 → 作为 tags(提升召回)
  // 支持:
  //   [[note-name]]          → note-name
  //   [[note-name|alias]]     → note-name (丢弃 alias)
  //   [[note-name#heading]]   → note-name (丢弃 heading)
  //   [[note-name#^block-id]] → note-name (丢弃 block-id)
  // 大小写保留(因为 wiki-link 通常是文件名,大小写敏感)
  const wikiLinkTags = new Set<string>();
  // 重置 lastIndex
  WIKI_LINK_REGEX.lastIndex = 0;
  let wikiMatch;
  while ((wikiMatch = WIKI_LINK_REGEX.exec(body)) !== null) {
    const name = wikiMatch[1].trim();
    if (name && name.length <= 100) { // 防止异常长链接
      wikiLinkTags.add(name);
    }
  }

  return {
    title,
    frontmatterTags,
    inlineTags: [...inlineTags],
    wikiLinkTags: [...wikiLinkTags],
    bodyWithoutFrontmatter: body,
  };
}

/** 知识库递归深度上限(P0-3:防止符号链接循环或异常深层目录致栈溢出) */
const MAX_KB_DEPTH = 8;

/** 递归扫描目录下所有 .md 文件 */
async function scanMarkdownFiles(rootDir: string, depth = 0): Promise<string[]> {
  if (depth >= MAX_KB_DEPTH) {
    logWarn(`KB scan exceeded max depth ${MAX_KB_DEPTH} at ${rootDir}, skipping`);
    return [];
  }
  const result: string[] = [];
  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      // 跳过隐藏目录(.git, .obsidian, .trash, .vscode 等)
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(rootDir, entry.name);
      // P0-3:用 lstat 检测符号链接,避免循环引用导致无限递归
      // withFileTypes 已给出 entry,但符号链接需要单独 lstat 才能识别
      let isSymlink = false;
      try {
        const stat = await fs.lstat(fullPath);
        isSymlink = stat.isSymbolicLink();
      } catch {
        // lstat 失败(权限/不存在)按非符号链接处理,后续 readdir/readFile 会再报错
      }
      if (isSymlink) {
        logWarn(`KB scan skipping symlink ${fullPath}`);
        continue;
      }
      if (entry.isDirectory()) {
        const sub = await scanMarkdownFiles(fullPath, depth + 1);
        result.push(...sub);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        result.push(fullPath);
      }
    }
  } catch (err) {
    logError('KB scan failed', err);
    // 目录不存在或无权限:返回空,不阻断
  }
  return result;
}

/** 检查关键词是否命中字段(大小写不敏感) */
function matchField(field: string, keywords: string[]): boolean {
  const fieldLower = field.toLowerCase();
  return keywords.some(kw => fieldLower.includes(kw.toLowerCase()));
}

/** 找到命中的字段(优先级:title > path > tag > content) */
function findMatchedField(
  title: string,
  pathStr: string,
  tags: string[],
  content: string,
  keywords: string[],
): KnowledgeItem['matchedField'] | null {
  if (matchField(title, keywords)) return 'title';
  if (matchField(pathStr, keywords)) return 'path';
  if (tags.some(t => matchField(t, keywords))) return 'tag';
  if (matchField(content.slice(0, 2000), keywords)) return 'content';
  return null;
}

/**
 * 搜索本地 Markdown 知识库。
 *
 * @param kbRoots 知识库根目录列表
 * @param opts 搜索选项
 * @returns 匹配的 KnowledgeItem 列表,按命中字段优先级排序
 */
export async function searchKnowledgeBase(
  kbRoots: string[],
  opts: KnowledgeSearchOpts,
): Promise<KnowledgeItem[]> {
  const { keywords, limit = 10, maxFileKb } = opts;
  if (kbRoots.length === 0 || keywords.length === 0) return [];

  const maxFileBytes = maxFileKb * 1024;
  const items: KnowledgeItem[] = [];

  // 并行扫描所有根目录 + 识别知识库类型
  const allFiles = await Promise.all(
    kbRoots.map(async root => {
      const normalizedRoot = path.resolve(root);
      const files = await scanMarkdownFiles(normalizedRoot);
      const kbType = await detectKbType(normalizedRoot);
      return { root: normalizedRoot, files, kbType };
    }),
  );

  // 并行读取并匹配所有文件
  const readTasks: Promise<void>[] = [];
  for (const { root, files, kbType } of allFiles) {
    for (const file of files) {
      readTasks.push((async () => {
        try {
          const stat = await fs.stat(file);
          if (stat.size > maxFileBytes) return; // 超大文件跳过

          const content = await fs.readFile(file, 'utf-8');
          const fileName = path.basename(file);
          const parsed = parseMarkdown(content, fileName);

          const relativePath = path.relative(root, file);
          // 合并所有 tags 来源:frontmatter + inline #tag + [[wiki-link]]
          // 去重:三个来源可能重复(如 frontmatter tags:[foo] + 正文 #foo)
          const allTags = [...new Set([...parsed.frontmatterTags, ...parsed.inlineTags, ...parsed.wikiLinkTags])];

          const matchedField = findMatchedField(
            parsed.title,
            relativePath,
            allTags,
            parsed.bodyWithoutFrontmatter,
            keywords,
          );
          if (!matchedField) return;

          items.push({
            title: parsed.title,
            relativePath,
            absolutePath: file,
            // file:// URL:补第 3 个斜杠(Windows D:\path -> file:///D:/path)
            // 同时去前导斜杠(Unix /home/x -> file:///home/x,避免 4 个斜杠)
            url: `file:///${file.replace(/\\/g, '/').replace(/^\/+/, '')}`,
            snippet: parsed.bodyWithoutFrontmatter.slice(0, 500).trim(),
            tags: allTags,
            lastUpdated: stat.mtime.toISOString(),
            matchedField,
            kbRoot: root,
            kbType,
          });
        } catch (err) {
          logError('KB parse failed', err);
          // 单文件读取失败:跳过,不阻断
        }
      })());
    }
  }
  await Promise.all(readTasks);

  // 排序:命中字段优先级(title > path > tag > content)
  const fieldOrder: Record<KnowledgeItem['matchedField'], number> = {
    title: 0,
    path: 1,
    tag: 2,
    content: 3,
  };
  items.sort((a, b) => {
    const fieldDiff = fieldOrder[a.matchedField] - fieldOrder[b.matchedField];
    if (fieldDiff !== 0) return fieldDiff;
    // 同字段类型,按更新时间倒序(新的优先)
    return (b.lastUpdated || '').localeCompare(a.lastUpdated || '');
  });

  return items.slice(0, limit);
}
