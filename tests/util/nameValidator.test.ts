// tests/util/nameValidator.test.ts
import { describe, it, expect } from 'vitest';
import { isValidOwnerRepo } from '../../src/util/nameValidator.js';

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
