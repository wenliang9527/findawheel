// eslint.config.js — ESLint 9 flat config
// 策略:只抓真正的 bug(js/ts recommended),不强制代码风格(风格交给 Prettier,两者解耦)。
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  // 忽略产物与依赖目录
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  // JS 基础推荐规则
  js.configs.recommended,
  // TS 推荐规则(抓类型相关 bug,不含 stylistic 风格规则)
  ...tseslint.configs.recommended,
  // 关闭与 Prettier 冲突的格式规则
  prettier,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // 下划线前缀视为有意未使用(项目里已有 _omit 等惯例)
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      // any 警告而非错误(项目几乎无 any,保留提示)
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
