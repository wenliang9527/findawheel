// tests/util/nameValidator.test.ts
import { describe, it, expect } from 'vitest';
import { isValidOwnerRepo, isValidWheelName } from '../../src/util/nameValidator.js';

describe('isValidOwnerRepo', () => {
  describe('合法格式', () => {
    it('标准 owner/repo', () => {
      expect(isValidOwnerRepo('facebook/react')).toBe(true);
      expect(isValidOwnerRepo('vuejs/core')).toBe(true);
      expect(isValidOwnerRepo('microsoft/vscode')).toBe(true);
    });

    it('含数字', () => {
      expect(isValidOwnerRepo('user123/repo456')).toBe(true);
      expect(isValidOwnerRepo('foo/bar123')).toBe(true);
    });

    it('含点号(常见于组织名)', () => {
      expect(isValidOwnerRepo('some.org/repo')).toBe(true);
      expect(isValidOwnerRepo('owner/repo.name')).toBe(true);
    });

    it('含连字符', () => {
      expect(isValidOwnerRepo('my-org/my-repo')).toBe(true);
      expect(isValidOwnerRepo('a-b/c-d')).toBe(true);
    });

    it('含下划线', () => {
      expect(isValidOwnerRepo('a_b/c_d')).toBe(true);
    });

    it('单字符 owner/repo', () => {
      expect(isValidOwnerRepo('a/b')).toBe(true);
    });
  });

  describe('非法格式', () => {
    it('无斜杠', () => {
      expect(isValidOwnerRepo('foo')).toBe(false);
      expect(isValidOwnerRepo('justaname')).toBe(false);
    });

    it('空字符串', () => {
      expect(isValidOwnerRepo('')).toBe(false);
    });

    it('只有斜杠', () => {
      expect(isValidOwnerRepo('/')).toBe(false);
      expect(isValidOwnerRepo('//')).toBe(false);
    });

    it('owner 为空', () => {
      expect(isValidOwnerRepo('/repo')).toBe(false);
    });

    it('repo 为空', () => {
      expect(isValidOwnerRepo('foo/')).toBe(false);
    });

    it('多段斜杠', () => {
      expect(isValidOwnerRepo('a/b/c')).toBe(false);
      expect(isValidOwnerRepo('a/b/c/d')).toBe(false);
    });

    it('含非法字符(空格)', () => {
      expect(isValidOwnerRepo('foo bar/baz')).toBe(false);
      expect(isValidOwnerRepo('foo/bar baz')).toBe(false);
    });

    it('含非法字符(特殊符号)', () => {
      expect(isValidOwnerRepo('foo@/bar')).toBe(false);
      expect(isValidOwnerRepo('foo/bar!')).toBe(false);
      expect(isValidOwnerRepo('foo/bar#')).toBe(false);
    });

    it('含中文', () => {
      expect(isValidOwnerRepo('中文/repo')).toBe(false);
      expect(isValidOwnerRepo('foo/中文')).toBe(false);
    });

    it('含 @ 符号(email)', () => {
      expect(isValidOwnerRepo('user@example.com/repo')).toBe(false);
    });
  });
});

describe('isValidWheelName', () => {
  describe('合法格式(宽松,多源兼容)', () => {
    it('owner/repo 格式', () => {
      expect(isValidWheelName('facebook/react')).toBe(true);
      expect(isValidWheelName('a/b')).toBe(true);
    });

    it('npm 包名(无斜杠 / scoped)', () => {
      expect(isValidWheelName('lodash')).toBe(true);
      expect(isValidWheelName('@lodash/foo')).toBe(true);
      expect(isValidWheelName('express')).toBe(true);
    });

    it('crates / pypi / maven 等单段或点分名', () => {
      expect(isValidWheelName('serde')).toBe(true);
      expect(isValidWheelName('django')).toBe(true);
      expect(isValidWheelName('org.apache.commons')).toBe(true);
    });

    it('含空格 / 特殊符号 / 中文(宽松接受,各源 name 格式不同)', () => {
      expect(isValidWheelName('foo bar/baz')).toBe(true);
      expect(isValidWheelName('foo@/bar')).toBe(true);
      expect(isValidWheelName('中文/repo')).toBe(true);
      expect(isValidWheelName('a/b/c')).toBe(true);
    });

    it('github-code 风格 name(owner/repo#path)', () => {
      expect(isValidWheelName('owner/repo#path/to/file')).toBe(true);
    });
  });

  describe('非法格式', () => {
    it('空字符串', () => {
      expect(isValidWheelName('')).toBe(false);
    });

    it('纯空白(空格/制表符)', () => {
      expect(isValidWheelName('   ')).toBe(false);
      expect(isValidWheelName('\t')).toBe(false);
    });

    it('路径穿越 (..)', () => {
      expect(isValidWheelName('..')).toBe(false);
      expect(isValidWheelName('../etc/passwd')).toBe(false);
      expect(isValidWheelName('foo/../bar')).toBe(false);
      expect(isValidWheelName('a/..')).toBe(false);
    });

    it('含 null 字节', () => {
      expect(isValidWheelName('foo\0bar')).toBe(false);
    });

    it('超长 name (>200 字符)', () => {
      expect(isValidWheelName('a'.repeat(201))).toBe(false);
      expect(isValidWheelName('a'.repeat(200))).toBe(true);
    });

    it('非字符串(null/undefined)', () => {
      expect(isValidWheelName(null as unknown as string)).toBe(false);
      expect(isValidWheelName(undefined as unknown as string)).toBe(false);
    });
  });
});
