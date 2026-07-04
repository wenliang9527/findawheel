// tests/classifier/sourceRouter.test.ts
import { describe, it, expect } from 'vitest';
import { routeSources, ALL_SOURCES, type RoutingContext } from '../../src/classifier/sourceRouter.js';
import { parseQuery } from '../../src/classifier/queryParser.js';
import { translateQuery } from '../../src/classifier/queryTranslator.js';

function makeCtx(query: string, ecosystem?: string): RoutingContext {
  const parsedQuery = parseQuery(query);
  const translatedQuery = translateQuery(query);
  return {
    query,
    translatedQuery,
    ecosystem: ecosystem ?? parsedQuery.ecosystem,
    intent: 'project',
    parsedQuery,
  };
}

describe('routeSources', () => {
  describe('ecosystem-based routing', () => {
    it('routes python ecosystem to PyPI/GitHub/Libraries.io/web', () => {
      const result = routeSources(makeCtx('python web framework', 'python'));
      expect(result.selected).toEqual(['pypi', 'github', 'librariesio', 'web']);
      expect(result.skipped).toContain('registry');
      expect(result.skipped).toContain('vscode-marketplace');
      expect(result.skipped).toContain('huggingface');
      expect(result.ruleName).toBe('python-ecosystem');
      expect(result.reason).toContain('python');
    });

    it('routes js ecosystem to npm/GitHub/Libraries.io/web', () => {
      const result = routeSources(makeCtx('react component', 'js'));
      expect(result.selected).toContain('registry');
      expect(result.selected).toContain('github');
      expect(result.skipped).toContain('pypi');
      expect(result.ruleName).toBe('js-ts-ecosystem');
    });

    it('routes ts ecosystem same as js', () => {
      const result = routeSources(makeCtx('typescript library', 'ts'));
      expect(result.selected).toContain('registry');
      expect(result.ruleName).toBe('js-ts-ecosystem');
    });

    it('routes rust ecosystem to GitHub/Libraries.io/web', () => {
      const result = routeSources(makeCtx('rust crate', 'rust'));
      expect(result.selected).toEqual(['github', 'librariesio', 'web']);
      expect(result.skipped).toContain('registry');
      expect(result.skipped).toContain('pypi');
      expect(result.ruleName).toBe('compiled-ecosystem');
      expect(result.reason).toContain('rust');
    });

    it('routes cpp ecosystem to GitHub/Gitee/PapersWithCode/web', () => {
      const result = routeSources(makeCtx('c++ library', 'cpp'));
      expect(result.selected).toContain('github');
      expect(result.selected).toContain('gitee');
      expect(result.selected).toContain('paperswithcode');
      expect(result.skipped).toContain('registry');
      expect(result.skipped).toContain('pypi');
      expect(result.ruleName).toBe('cpp-arduino-ecosystem');
    });

    it('routes arduino ecosystem same as cpp', () => {
      const result = routeSources(makeCtx('arduino sketch', 'arduino'));
      expect(result.selected).toContain('gitee');
      expect(result.ruleName).toBe('cpp-arduino-ecosystem');
    });
  });

  describe('hardware keyword routing (no ecosystem needed)', () => {
    it('routes stepper motor query to hardware sources', () => {
      const result = routeSources(makeCtx('stepper motor control'));
      expect(result.ruleName).toBe('hardware-keywords');
      expect(result.selected).toContain('github');
      expect(result.selected).toContain('gitee');
      expect(result.selected).toContain('github-code');
      expect(result.skipped).toContain('registry');
      expect(result.skipped).toContain('pypi');
      expect(result.skipped).toContain('vscode-marketplace');
      expect(result.skipped).toContain('huggingface');
    });

    it('detects hardware from translated Chinese query', () => {
      // 中文"步进电机"应翻译为 stepper-motor,触发 hardware 路由
      const result = routeSources(makeCtx('步进电机驱动器'));
      expect(result.ruleName).toBe('hardware-keywords');
      expect(result.selected).toContain('gitee');
      expect(result.skipped).toContain('pypi');
    });

    it('detects esp32 as hardware (routes to cpp sources)', () => {
      const result = routeSources(makeCtx('esp32 wifi scanner'));
      expect(result.ruleName).toBe('hardware-keywords');
      expect(result.selected).toContain('github');
      expect(result.selected).toContain('gitee');
      expect(result.skipped).toContain('pypi');
    });

    it('detects stm32 as hardware', () => {
      const result = routeSources(makeCtx('stm32 hal driver'));
      expect(result.ruleName).toBe('hardware-keywords');
      expect(result.skipped).toContain('registry');
    });
  });

  describe('VSCode extension routing', () => {
    it('routes vscode query to VSCode Marketplace', () => {
      const result = routeSources(makeCtx('vscode extension for markdown'));
      expect(result.ruleName).toBe('vscode-extension');
      expect(result.selected).toContain('vscode-marketplace');
      expect(result.selected).toContain('github');
      expect(result.skipped).toContain('pypi');
      expect(result.skipped).toContain('huggingface');
    });

    it('detects Chinese 插件 keyword', () => {
      const result = routeSources(makeCtx('markdown 插件'));
      expect(result.ruleName).toBe('vscode-extension');
      expect(result.selected).toContain('vscode-marketplace');
    });
  });

  describe('AI/ML routing', () => {
    it('routes llm query to HuggingFace/PapersWithCode', () => {
      const result = routeSources(makeCtx('llm training framework'));
      expect(result.ruleName).toBe('ai-ml-model');
      expect(result.selected).toContain('huggingface');
      expect(result.selected).toContain('paperswithcode');
      expect(result.skipped).toContain('registry');
      expect(result.skipped).toContain('pypi');
    });

    it('detects transformer model query', () => {
      const result = routeSources(makeCtx('transformer neural network'));
      expect(result.ruleName).toBe('ai-ml-model');
      expect(result.selected).toContain('huggingface');
    });

    it('does not route generic "model" word alone (needs combo)', () => {
      // "model" 单独出现不触发 AI/ML 路由(避免过激)
      // "mvc model" 应走兜底全搜
      const result = routeSources(makeCtx('mvc model'));
      expect(result.ruleName).toBe('fallback-all');
      expect(result.skipped).toHaveLength(0);
    });
  });

  describe('paper/algorithm routing', () => {
    it('routes paper query to PapersWithCode', () => {
      const result = routeSources(makeCtx('attention is all you need paper'));
      expect(result.ruleName).toBe('paper-algorithm');
      expect(result.selected).toContain('paperswithcode');
      expect(result.skipped).toContain('pypi');
      expect(result.skipped).toContain('huggingface');
    });

    it('detects Chinese 算法 keyword', () => {
      const result = routeSources(makeCtx('排序算法'));
      expect(result.ruleName).toBe('paper-algorithm');
    });
  });

  describe('code snippet routing', () => {
    it('routes snippet query to GitHub Code Search', () => {
      const result = routeSources(makeCtx('file upload snippet'));
      expect(result.ruleName).toBe('code-snippet');
      expect(result.selected).toContain('github-code');
      expect(result.skipped).toContain('pypi');
    });

    it('detects Chinese 示例 keyword', () => {
      const result = routeSources(makeCtx('react 示例'));
      // 注意:frontend-ui 规则在 code-snippet 之后,会先匹配 code-snippet
      expect(result.ruleName).toBe('code-snippet');
    });
  });

  describe('frontend UI routing', () => {
    it('routes react query to npm/GitHub', () => {
      const result = routeSources(makeCtx('react form component'));
      expect(result.ruleName).toBe('frontend-ui');
      expect(result.selected).toContain('registry');
      expect(result.selected).toContain('github');
      expect(result.skipped).toContain('pypi');
      expect(result.skipped).toContain('huggingface');
    });

    it('detects Chinese 前端 keyword', () => {
      const result = routeSources(makeCtx('前端组件'));
      expect(result.ruleName).toBe('frontend-ui');
      expect(result.selected).toContain('registry');
    });
  });

  describe('fallback (no match)', () => {
    it('falls back to all sources for generic query', () => {
      const result = routeSources(makeCtx('markdown editor'));
      expect(result.ruleName).toBe('fallback-all');
      expect(result.selected).toEqual([...ALL_SOURCES]);
      expect(result.skipped).toHaveLength(0);
      expect(result.reason).toContain('全搜');
    });

    it('falls back for empty-ish query', () => {
      const result = routeSources(makeCtx('x'));
      expect(result.ruleName).toBe('fallback-all');
      expect(result.skipped).toHaveLength(0);
    });
  });

  describe('priority (first match wins)', () => {
    it('ecosystem=python wins over hardware keywords', () => {
      // 即使 query 含 motor,ecosystem=python 优先
      const result = routeSources(makeCtx('motor control', 'python'));
      expect(result.ruleName).toBe('python-ecosystem');
      expect(result.selected).toContain('pypi');
    });

    it('hardware keywords win over frontend-ui', () => {
      // "motor" 是硬件词,不应走 frontend-ui
      const result = routeSources(makeCtx('motor component'));
      expect(result.ruleName).toBe('hardware-keywords');
    });
  });

  describe('ALL_SOURCES completeness', () => {
    it('contains all 11 sources', () => {
      expect(ALL_SOURCES).toHaveLength(11);
    });

    it('selected + skipped = ALL_SOURCES for any rule', () => {
      // 验证所有规则 selected ∪ skipped = ALL_SOURCES
      const testCases = [
        makeCtx('python lib', 'python'),
        makeCtx('react component', 'js'),
        makeCtx('rust crate', 'rust'),
        makeCtx('stepper motor'),
        makeCtx('vscode extension'),
        makeCtx('llm training'),
        makeCtx('attention paper'),
        makeCtx('file snippet'),
        makeCtx('react form'),
        makeCtx('generic query'),
      ];
      for (const ctx of testCases) {
        const result = routeSources(ctx);
        const union = [...result.selected, ...result.skipped];
        expect(union.sort()).toEqual([...ALL_SOURCES].sort());
      }
    });
  });
});
