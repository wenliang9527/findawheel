// tests/util/html.test.ts
// 验证 htmlToText:将 README 顶部常见的 HTML banner/badge 块清理为简洁 markdown。
//
// 这层测试存在的价值:
// - readmeFetcher 返回的 readmeSnippet 直接喂给 AI 上下文,HTML 标签占用大量 token
//   却信息密度极低(badge/shield.io 图片对 AI 毫无意义)
// - htmlToText 必须对纯 markdown 幂等(无 HTML 时原样返回),否则会破坏 README 正文
// - 代码块必须转为 ``` 围栏,后续 codeSnippetExtractor 才能正确提取
import { describe, it, expect } from 'vitest';
import { htmlToText } from '../../src/util/html.js';

describe('htmlToText', () => {
  it('returns empty string for empty/undefined input', () => {
    expect(htmlToText('')).toBe('');
  });

  it('is idempotent on plain markdown (no HTML tags)', () => {
    // 纯 markdown 不应被改变(README 正文大多是 markdown)
    const md = `# Title

Some paragraph with **bold** and *italic*.

\`\`\`bash
npm install foo
\`\`\`

- item 1
- item 2`;
    expect(htmlToText(md)).toBe(md);
  });

  it('removes img tags (badge/shield.io banners)', () => {
    const html = `<p><img src="https://img.shields.io/npm/v/foo.svg" alt="version"/></p>
text`;
    const result = htmlToText(html);
    expect(result).not.toContain('<img');
    expect(result).not.toContain('shields.io');
    expect(result).toContain('text');
  });

  it('preserves meaningful alt text but drops badge/shield/icon alt', () => {
    // 有意义的 alt(如截图说明)应保留
    const html1 = `<img src="screenshot.png" alt="main interface"/>`;
    expect(htmlToText(html1)).toContain('main interface');
    // 以 badge/shield/icon 开头的 alt 应丢弃(对 AI 无意义)
    const html2 = `<img src="v.svg" alt="badge version"/>`;
    const result2 = htmlToText(html2);
    expect(result2).not.toContain('badge version');
    expect(result2).not.toContain('badge');
    const html3 = `<img src="i.svg" alt="shield"/>`;
    expect(htmlToText(html3)).toBe('');
  });

  it('converts html headings to markdown headings', () => {
    const html = `<h1>Title</h1><h2>Section</h2><h3>Sub</h3><h4>Minor</h4>`;
    const result = htmlToText(html);
    expect(result).toContain('# Title');
    expect(result).toContain('## Section');
    expect(result).toContain('### Sub');
    expect(result).toContain('#### Minor');
    expect(result).not.toContain('<h');
  });

  it('converts pre>code blocks to markdown fenced blocks', () => {
    // codeSnippetExtractor 用 ``` 围栏提取代码块,必须保留围栏语义
    const html = `<pre><code class="language-bash">npm install foo</code></pre>`;
    const result = htmlToText(html);
    expect(result).toContain('```');
    expect(result).toContain('npm install foo');
    expect(result).not.toContain('<pre');
    expect(result).not.toContain('<code');
  });

  it('converts inline code to backticks', () => {
    const html = `Use <code>foo()</code> to call.`;
    const result = htmlToText(html);
    expect(result).toContain('`foo()`');
    expect(result).not.toContain('<code');
  });

  it('preserves link text but drops URL', () => {
    // AI 不需要点击,只要文本
    const html = `<a href="https://example.com">click here</a>`;
    const result = htmlToText(html);
    expect(result).toContain('click here');
    expect(result).not.toContain('href');
    expect(result).not.toContain('example.com');
  });

  it('converts li tags to markdown list items', () => {
    const html = `<ul><li>one</li><li>two</li></ul>`;
    const result = htmlToText(html);
    expect(result).toContain('- one');
    expect(result).toContain('- two');
  });

  it('converts br and p tags to newlines', () => {
    const html = `line1<br/>line2<p>paragraph</p>`;
    const result = htmlToText(html);
    expect(result).toContain('line1');
    expect(result).toContain('line2');
    expect(result).toContain('paragraph');
    expect(result).not.toContain('<br');
    expect(result).not.toContain('<p');
  });

  it('strips script/style blocks and html comments', () => {
    const html = `<script>alert('x')</script>
<style>.x { color: red; }</style>
<!-- a comment -->
visible`;
    const result = htmlToText(html);
    expect(result).not.toContain('alert');
    expect(result).not.toContain('color');
    expect(result).not.toContain('comment');
    expect(result).not.toContain('<script');
    expect(result).not.toContain('<style');
    expect(result).toContain('visible');
  });

  it('decodes common HTML entities', () => {
    const html = `a &amp; b &lt; c &gt; d &quot;e&quot; f&#39;g h&nbsp;i`;
    const result = htmlToText(html);
    expect(result).toContain('a & b');
    expect(result).toContain('b < c');
    expect(result).toContain('c > d');
    expect(result).toContain('"e"');
    expect(result).toContain("f'g");
    expect(result).toContain('h i');
  });

  it('collapses 3+ consecutive newlines into 2', () => {
    const html = `a<br/><br/><br/><br/>b`;
    const result = htmlToText(html);
    expect(result).not.toMatch(/\n{3,}/);
  });

  it('strips remaining wrapper tags (div/span/align)', () => {
    const html = `<div align="center"><span class="x">text</span></div>`;
    const result = htmlToText(html);
    expect(result).toBe('text');
  });

  it('handles realistic README top: HTML banner + markdown body', () => {
    // 模拟 AgentPet README 顶部典型结构
    const readme = `<div align="center">
  <img src="assets/banner.png" alt="AgentPet" width="100%" />
  <p><a href="https://npmjs.com/package/agentpet"><img src="https://img.shields.io/npm/v/agentpet.svg" alt="npm badge"/></a></p>
</div>

# AgentPet

A tool to manage pets.

\`\`\`bash
npm install agentpet
\`\`\`

## Usage

Run \`agentpet init\` to start.`;
    const result = htmlToText(readme);
    // banner/badge/shield.io 应被移除
    expect(result).not.toContain('<img');
    expect(result).not.toContain('shields.io');
    expect(result).not.toContain('npmjs.com');
    expect(result).not.toContain('<div');
    expect(result).not.toContain('<a ');
    // 保留主体内容
    expect(result).toContain('# AgentPet');
    expect(result).toContain('A tool to manage pets.');
    expect(result).toContain('npm install agentpet');
    expect(result).toContain('## Usage');
    expect(result).toContain('`agentpet init`');
    // 已有 markdown 围栏不应被破坏
    expect(result).toMatch(/```bash[\s\S]*npm install agentpet[\s\S]*```/);
  });
});
