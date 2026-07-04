// src/sources/knowledgeSourceAdapter.ts
// 个人知识库搜索适配器(本地 Markdown 文件夹)。
//
// 设计:
// 1. 多根支持(FINDAWHEEL_KB_ROOT 逗号分隔多个路径)
// 2. 扫描 .md 文件,提取标题/路径/snippet/tags
// 3. 标签来源:YAML frontmatter 的 tags/categories + 正文 inline #tag
// 4. 缓存可选(FINDAWHEEL_KB_CACHE_ENABLED,默认 false 每次扫描保证最新)
// 5. 单文件大小上限(FINDAWHEEL_KB_MAX_FILE_KB,默认 100KB)
//
// 搜索字段优先级:title > path > tags > content
// 不做全文搜索/向量检索,保持零依赖和与"不调 LLM"约束一致。

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

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
  /** 从 frontmatter 和 inline #tag 提取的标签 */
  tags: string[];
  /** 文件最后修改时间(ISO date) */
  lastUpdated?: string;
  /** 命中字段,帮 AI 判断相关性 */
  matchedField: 'title' | 'path' | 'tag' | 'content';
  /** 所属知识库根目录(用于多根场景区分来源) */
  kbRoot: string;
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
  bodyWithoutFrontmatter: string;
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
  }

  // 2. 提取标题:第一行 H1,或文件名
  let title = fileName.replace(/\.md$/i, '');
  const h1Match = body.match(/^#\s+(.+?)\s*$/m);
  if (h1Match) {
    title = h1Match[1].trim();
  }

  // 3. 提取 inline #tag(正文里的 #tag 形式,排除 # 标题语法)
  const inlineTags = new Set<string>();
  // 匹配 #tag(后面跟非字母数字或行尾,前面是空格或行首)
  // 排除 ## ### 等 markdown 标题(# 后跟空格)
  const tagRegex = /(?:^|\s)#([a-z][a-z0-9_-]*)/gi;
  let tagMatch;
  while ((tagMatch = tagRegex.exec(body)) !== null) {
    inlineTags.add(tagMatch[1].toLowerCase());
  }

  return {
    title,
    frontmatterTags,
    inlineTags: [...inlineTags],
    bodyWithoutFrontmatter: body,
  };
}

/** 递归扫描目录下所有 .md 文件 */
async function scanMarkdownFiles(rootDir: string): Promise<string[]> {
  const result: string[] = [];
  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      // 跳过隐藏目录(.git, .obsidian, .trash 等)
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        const sub = await scanMarkdownFiles(fullPath);
        result.push(...sub);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        result.push(fullPath);
      }
    }
  } catch {
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

  // 并行扫描所有根目录
  const allFiles = await Promise.all(
    kbRoots.map(async root => {
      const normalizedRoot = path.resolve(root);
      const files = await scanMarkdownFiles(normalizedRoot);
      return { root: normalizedRoot, files };
    }),
  );

  // 并行读取并匹配所有文件
  const readTasks: Promise<void>[] = [];
  for (const { root, files } of allFiles) {
    for (const file of files) {
      readTasks.push((async () => {
        try {
          const stat = await fs.stat(file);
          if (stat.size > maxFileBytes) return; // 超大文件跳过

          const content = await fs.readFile(file, 'utf-8');
          const fileName = path.basename(file);
          const parsed = parseMarkdown(content, fileName);

          const relativePath = path.relative(root, file);
          const allTags = [...parsed.frontmatterTags, ...parsed.inlineTags];

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
            url: `file://${file.replace(/\\/g, '/')}`,
            snippet: parsed.bodyWithoutFrontmatter.slice(0, 500).trim(),
            tags: allTags,
            lastUpdated: stat.mtime.toISOString(),
            matchedField,
            kbRoot: root,
          });
        } catch {
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
