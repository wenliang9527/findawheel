// tests/sources/knowledgeSourceAdapter.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { searchKnowledgeBase } from '../../src/sources/knowledgeSourceAdapter.js';

let tmpDir: string;

async function writeMd(relativePath: string, content: string) {
  const fullPath = path.join(tmpDir, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf-8');
  // 修正 mtime 让某些文件"更新"
  const future = new Date(Date.now() + 60_000);
  await fs.utimes(fullPath, future, future);
  return fullPath;
}

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-test-'));
  // 文件 1:有 frontmatter tags 数组格式
  await writeMd('notes/adr-001.md', `---
tags: [architecture, decision]
---

# ADR 001: Use Redis for Cache

We decided to use Redis as the cache layer.
`);
  // 文件 2:frontmatter 多行 tags + inline tag
  await writeMd('projects/auth.md', `---
tags:
  - authentication
  - security
---

# Auth Module Design

Implements JWT-based auth #security #backend

Some content about login flow.
`);
  // 文件 3:inline tag only
  await writeMd('snippets/python-utils.md', `# Python Utilities

Helper functions for daily use #python #snippet

\`\`\`python
def hello():
    print("hello")
\`\`\`
`);
  // 文件 4:标题命中,内容不含关键词
  await writeMd('docs/design.md', `# System Design

General architecture overview with no specific keyword match.
`);
  // 文件 5:不匹配任何字段(应被排除)
  await writeMd('docs/unrelated.md', `# Cooking Notes

How to make pasta with tomato sauce.
`);
  // 文件 6:大文件(超过 maxFileKb 限制,应被跳过)
  const big = '# Big\n\n' + 'x'.repeat(200 * 1024);
  await writeMd('big/too-large.md', big);
  // 文件 7:无标题,用文件名作 title
  await writeMd('misc/just-content.md', `This file has no H1 header.
It just talks about redis configuration.
`);
  // 文件 8:categories 字段
  await writeMd('devops/k8s.md', `---
categories: [kubernetes, deploy]
---

# Kubernetes Deployment

How to deploy to k8s.
`);
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('knowledgeSourceAdapter', () => {
  describe('basic search', () => {
    it('returns matching files by title', async () => {
      const items = await searchKnowledgeBase([tmpDir], {
        keywords: ['system'],
        limit: 10,
        maxFileKb: 100,
      });
      expect(items.length).toBe(1);
      expect(items[0].title).toBe('System Design');
      expect(items[0].matchedField).toBe('title');
    });

    it('returns matching files by path', async () => {
      const items = await searchKnowledgeBase([tmpDir], {
        keywords: ['devops'],
        limit: 10,
        maxFileKb: 100,
      });
      // 'devops' 命中 devops/k8s.md 的路径
      const pathMatch = items.find(i => i.matchedField === 'path');
      expect(pathMatch).toBeDefined();
      expect(pathMatch!.relativePath).toContain('k8s.md');
    });

    it('returns matching files by tag (frontmatter array format)', async () => {
      const items = await searchKnowledgeBase([tmpDir], {
        keywords: ['architecture'],
        limit: 10,
        maxFileKb: 100,
      });
      const tagMatch = items.find(i => i.matchedField === 'tag');
      expect(tagMatch).toBeDefined();
      expect(tagMatch!.tags).toContain('architecture');
    });

    it('returns matching files by tag (frontmatter multiline format)', async () => {
      const items = await searchKnowledgeBase([tmpDir], {
        keywords: ['authentication'],
        limit: 10,
        maxFileKb: 100,
      });
      const tagMatch = items.find(i => i.matchedField === 'tag');
      expect(tagMatch).toBeDefined();
      expect(tagMatch!.tags).toContain('authentication');
    });

    it('returns matching files by inline #tag', async () => {
      const items = await searchKnowledgeBase([tmpDir], {
        keywords: ['backend'],
        limit: 10,
        maxFileKb: 100,
      });
      // 'backend' 是 inline #tag,应被识别为 tag 匹配
      const tagMatch = items.find(i => i.matchedField === 'tag');
      expect(tagMatch).toBeDefined();
      expect(tagMatch!.tags).toContain('backend');
    });

    it('returns matching files by content (when title/path/tag dont match)', async () => {
      const items = await searchKnowledgeBase([tmpDir], {
        keywords: ['pasta'],
        limit: 10,
        maxFileKb: 100,
      });
      expect(items.length).toBeGreaterThanOrEqual(1);
      const contentMatch = items.find(i => i.matchedField === 'content');
      expect(contentMatch).toBeDefined();
    });
  });

  describe('priority ordering', () => {
    it('title match ranks higher than content match', async () => {
      // 'design' 命中 System Design(标题),也可能命中其他文件 content
      const items = await searchKnowledgeBase([tmpDir], {
        keywords: ['design'],
        limit: 10,
        maxFileKb: 100,
      });
      if (items.length >= 2) {
        const fieldOrder = { title: 0, path: 1, tag: 2, content: 3 };
        for (let i = 1; i < items.length; i++) {
          const prev = fieldOrder[items[i - 1].matchedField];
          const curr = fieldOrder[items[i].matchedField];
          expect(prev).toBeLessThanOrEqual(curr);
        }
      }
    });
  });

  describe('edge cases', () => {
    it('returns empty when no files match', async () => {
      const items = await searchKnowledgeBase([tmpDir], {
        keywords: ['nonexistent-term-xyz'],
        limit: 10,
        maxFileKb: 100,
      });
      expect(items).toEqual([]);
    });

    it('skips files exceeding maxFileKb', async () => {
      const items = await searchKnowledgeBase([tmpDir], {
        keywords: ['big'],
        limit: 10,
        maxFileKb: 100,
      });
      // 'big' 出现在大文件标题,但应被跳过
      expect(items.find(i => i.title === 'Big')).toBeUndefined();
    });

    it('returns empty when keywords list is empty', async () => {
      const items = await searchKnowledgeBase([tmpDir], {
        keywords: [],
        limit: 10,
        maxFileKb: 100,
      });
      expect(items).toEqual([]);
    });

    it('returns empty when kbRoots is empty', async () => {
      const items = await searchKnowledgeBase([], {
        keywords: ['redis'],
        limit: 10,
        maxFileKb: 100,
      });
      expect(items).toEqual([]);
    });

    it('uses filename as title when no H1 header exists', async () => {
      const items = await searchKnowledgeBase([tmpDir], {
        keywords: ['redis'],
        limit: 10,
        maxFileKb: 100,
      });
      const noTitle = items.find(i => i.relativePath.includes('just-content'));
      expect(noTitle).toBeDefined();
      expect(noTitle!.title).toBe('just-content');
    });

    it('respects limit parameter', async () => {
      const items = await searchKnowledgeBase([tmpDir], {
        keywords: ['redis'],
        limit: 1,
        maxFileKb: 100,
      });
      expect(items.length).toBeLessThanOrEqual(1);
    });
  });

  describe('multiple roots', () => {
    let tmpDir2: string;
    beforeAll(async () => {
      tmpDir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-test2-'));
      await fs.mkdir(path.join(tmpDir2, 'subdir'), { recursive: true });
      await fs.writeFile(
        path.join(tmpDir2, 'subdir', 'parallel.md'),
        '# Parallel Computing\n\nAbout parallel processing #distributed',
      );
    });
    afterAll(async () => {
      await fs.rm(tmpDir2, { recursive: true, force: true });
    });

    it('searches across multiple root directories', async () => {
      const items = await searchKnowledgeBase([tmpDir, tmpDir2], {
        keywords: ['redis', 'parallel'],
        limit: 20,
        maxFileKb: 100,
      });
      // 应该在两个目录都找到结果
      const roots = new Set(items.map(i => i.kbRoot));
      expect(roots.size).toBeGreaterThanOrEqual(2);
    });
  });

  describe('categories frontmatter field', () => {
    it('extracts tags from categories: field', async () => {
      const items = await searchKnowledgeBase([tmpDir], {
        keywords: ['kubernetes'],
        limit: 10,
        maxFileKb: 100,
      });
      const k8sItem = items.find(i => i.relativePath.includes('k8s'));
      expect(k8sItem).toBeDefined();
      expect(k8sItem!.tags).toContain('kubernetes');
    });
  });

  describe('file URL format', () => {
    it('returns file:// URL with forward slashes', async () => {
      const items = await searchKnowledgeBase([tmpDir], {
        keywords: ['design'],
        limit: 10,
        maxFileKb: 100,
      });
      expect(items[0].url).toMatch(/^file:\/\/.+$/);
      // 不应包含反斜杠(已转换)
      expect(items[0].url).not.toContain('\\');
    });
  });

  describe('hidden directories', () => {
    it('skips .git, .obsidian, etc.', async () => {
      await fs.mkdir(path.join(tmpDir, '.obsidian'), { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, '.obsidian', 'config.md'),
        '# Config\n\nmentions redis',
      );
      const items = await searchKnowledgeBase([tmpDir], {
        keywords: ['redis'],
        limit: 50,
        maxFileKb: 100,
      });
      // 不应包含 .obsidian 下的文件
      expect(items.find(i => i.relativePath.includes('.obsidian'))).toBeUndefined();
    });
  });

  describe('[[wiki-link]] parsing', () => {
    beforeAll(async () => {
      await writeMd(
        'wiki-test/wiki-links.md',
        `# Wiki Link Test

References:
- [[redis-notes]]
- [[auth-module|auth-alias]]
- [[design-doc#architecture]]
- [[block-ref#^block-id-1]]

Some inline [[another-note]] here.
`,
      );
    });

    it('extracts [[note]] as tag', async () => {
      const items = await searchKnowledgeBase([tmpDir], {
        keywords: ['redis-notes'],
        limit: 10,
        maxFileKb: 100,
      });
      const item = items.find(i => i.relativePath.includes('wiki-links'));
      expect(item).toBeDefined();
      expect(item!.tags).toContain('redis-notes');
      expect(item!.matchedField).toBe('tag');
    });

    it('extracts [[note|alias]] as tag (drops alias)', async () => {
      const items = await searchKnowledgeBase([tmpDir], {
        keywords: ['auth-module'],
        limit: 10,
        maxFileKb: 100,
      });
      const item = items.find(i => i.relativePath.includes('wiki-links'));
      expect(item).toBeDefined();
      expect(item!.tags).toContain('auth-module');
      expect(item!.tags).not.toContain('auth-alias');
    });

    it('extracts [[note#heading]] as tag (drops heading)', async () => {
      const items = await searchKnowledgeBase([tmpDir], {
        keywords: ['design-doc'],
        limit: 10,
        maxFileKb: 100,
      });
      const item = items.find(i => i.relativePath.includes('wiki-links'));
      expect(item).toBeDefined();
      expect(item!.tags).toContain('design-doc');
      expect(item!.tags).not.toContain('architecture');
    });

    it('extracts [[note#^block-id]] as tag (drops block-id)', async () => {
      const items = await searchKnowledgeBase([tmpDir], {
        keywords: ['block-ref'],
        limit: 10,
        maxFileKb: 100,
      });
      const item = items.find(i => i.relativePath.includes('wiki-links'));
      expect(item).toBeDefined();
      expect(item!.tags).toContain('block-ref');
      expect(item!.tags).not.toContain('block-id-1');
    });
  });

  describe('aliases frontmatter field', () => {
    beforeAll(async () => {
      await writeMd(
        'alias-test/array-format.md',
        `---
aliases: [js-framework, frontend-lib]
---

# React Notes

React is a UI library.
`,
      );
      await writeMd(
        'alias-test/multiline-format.md',
        `---
aliases:
  - database-system
  - data-store
---

# PostgreSQL Guide

PostgreSQL is a powerful database.
`,
      );
    });

    it('extracts aliases from array format [name1, name2]', async () => {
      const items = await searchKnowledgeBase([tmpDir], {
        keywords: ['js-framework'],
        limit: 10,
        maxFileKb: 100,
      });
      const item = items.find(i => i.relativePath.includes('array-format'));
      expect(item).toBeDefined();
      expect(item!.tags).toContain('js-framework');
      expect(item!.tags).toContain('frontend-lib');
    });

    it('extracts aliases from multiline format', async () => {
      const items = await searchKnowledgeBase([tmpDir], {
        keywords: ['database-system'],
        limit: 10,
        maxFileKb: 100,
      });
      const item = items.find(i => i.relativePath.includes('multiline-format'));
      expect(item).toBeDefined();
      expect(item!.tags).toContain('database-system');
      expect(item!.tags).toContain('data-store');
    });
  });

  describe('knowledge base type detection', () => {
    let obsidianDir: string;
    let logseqDir: string;
    let siyuanDir: string;
    let plainDir: string;

    beforeAll(async () => {
      obsidianDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-obsidian-'));
      logseqDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-logseq-'));
      siyuanDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-siyuan-'));
      plainDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-plain-'));

      // Obsidian: .obsidian/ 配置目录
      await fs.mkdir(path.join(obsidianDir, '.obsidian'), { recursive: true });
      await fs.mkdir(path.join(obsidianDir, 'notes'), { recursive: true });
      await fs.writeFile(
        path.join(obsidianDir, 'notes', 'obsidian-note.md'),
        '# Obsidian Note\n\nContent about obsidian setup.',
      );

      // Logseq: logseq/ + pages/ 目录
      await fs.mkdir(path.join(logseqDir, 'logseq'), { recursive: true });
      await fs.mkdir(path.join(logseqDir, 'pages'), { recursive: true });
      await fs.writeFile(
        path.join(logseqDir, 'pages', 'logseq-note.md'),
        '# Logseq Page\n\nContent about logseq workflow.',
      );

      // 思源: conf/ + data/ 目录
      await fs.mkdir(path.join(siyuanDir, 'conf'), { recursive: true });
      await fs.mkdir(path.join(siyuanDir, 'data'), { recursive: true });
      await fs.writeFile(
        path.join(siyuanDir, 'data', 'siyuan-note.md'),
        '# Siyuan Note\n\nContent about siyuan note taking.',
      );

      // plain: 普通 .md 文件夹
      await fs.mkdir(path.join(plainDir, 'docs'), { recursive: true });
      await fs.writeFile(
        path.join(plainDir, 'docs', 'plain-note.md'),
        '# Plain Note\n\nJust a regular markdown folder.',
      );
    });

    afterAll(async () => {
      await Promise.all([
        fs.rm(obsidianDir, { recursive: true, force: true }),
        fs.rm(logseqDir, { recursive: true, force: true }),
        fs.rm(siyuanDir, { recursive: true, force: true }),
        fs.rm(plainDir, { recursive: true, force: true }),
      ]);
    });

    it('detects Obsidian by .obsidian/ directory', async () => {
      const items = await searchKnowledgeBase([obsidianDir], {
        keywords: ['obsidian'],
        limit: 10,
        maxFileKb: 100,
      });
      expect(items.length).toBeGreaterThan(0);
      expect(items[0].kbType).toBe('obsidian');
    });

    it('detects Logseq by logseq/ + pages/ directories', async () => {
      const items = await searchKnowledgeBase([logseqDir], {
        keywords: ['logseq'],
        limit: 10,
        maxFileKb: 100,
      });
      expect(items.length).toBeGreaterThan(0);
      expect(items[0].kbType).toBe('logseq');
    });

    it('detects Siyuan by conf/ + data/ directories', async () => {
      const items = await searchKnowledgeBase([siyuanDir], {
        keywords: ['siyuan'],
        limit: 10,
        maxFileKb: 100,
      });
      expect(items.length).toBeGreaterThan(0);
      expect(items[0].kbType).toBe('siyuan');
    });

    it('detects plain for ordinary .md folder', async () => {
      const items = await searchKnowledgeBase([plainDir], {
        keywords: ['plain'],
        limit: 10,
        maxFileKb: 100,
      });
      expect(items.length).toBeGreaterThan(0);
      expect(items[0].kbType).toBe('plain');
    });
  });
});
