// tests/enrich/codeSnippetExtractor.test.ts
import { describe, it, expect } from 'vitest';
import { extractCodeSnippets } from '../../src/enrich/codeSnippetExtractor.js';

describe('extractCodeSnippets', () => {
  it('extracts a single fenced block with language tag', () => {
    const readme = '# Title\n\n```bash\nnpm install x\n```\n';
    const result = extractCodeSnippets(readme);
    expect(result).toHaveLength(1);
    expect(result[0].language).toBe('bash');
    expect(result[0].code).toBe('npm install x');
  });

  it('limits result count to maxCount=2', () => {
    const readme =
      '```bash\nnpm install a\n```\n```bash\nnpm install b\n```\n```bash\nnpm install c\n```';
    const result = extractCodeSnippets(readme, { maxCount: 2 });
    expect(result).toHaveLength(2);
    expect(result[0].code).toBe('npm install a');
    expect(result[1].code).toBe('npm install b');
  });

  it('prioritizes bash before js regardless of appearance order', () => {
    const readme = '```js\nconst x = 1;\n```\n```bash\nnpm install y\n```';
    const result = extractCodeSnippets(readme);
    expect(result).toHaveLength(2);
    expect(result[0].language).toBe('bash');
    expect(result[1].language).toBe('js');
  });

  it('truncates each snippet to maxCharsPerSnippet=10 with "..." suffix', () => {
    const readme = '```bash\nnpm install something very long\n```';
    const result = extractCodeSnippets(readme, { maxCharsPerSnippet: 10 });
    expect(result[0].code).toBe('npm instal...');
  });

  it('returns empty array when no fenced code blocks exist', () => {
    const readme = '# Just a readme\n\nNo code here';
    const result = extractCodeSnippets(readme);
    expect(result).toEqual([]);
  });

  it('treats code block without language tag as language="text"', () => {
    const readme = '```\ncode here\n```';
    const result = extractCodeSnippets(readme);
    expect(result).toHaveLength(1);
    expect(result[0].language).toBe('text');
    expect(result[0].code).toBe('code here');
  });

  it('skips empty code blocks', () => {
    const readme = '```bash\n\n```';
    const result = extractCodeSnippets(readme);
    expect(result).toEqual([]);
  });
});
