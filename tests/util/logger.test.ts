// tests/util/logger.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { setLogLevel, logError, logWarn, logInfo, logDebug } from '../../src/util/logger.js';

describe('logger', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    setLogLevel('error'); // 默认 error 级别
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  describe('级别过滤', () => {
    it('error 级别只输出 error', () => {
      setLogLevel('error');
      logError('err msg');
      logWarn('warn msg');
      logInfo('info msg');
      logDebug('debug msg');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('ERROR');
      expect(output).toContain('err msg');
    });

    it('warn 级别输出 error + warn', () => {
      setLogLevel('warn');
      logError('err msg');
      logWarn('warn msg');
      logInfo('info msg');
      logDebug('debug msg');
      expect(stderrSpy).toHaveBeenCalledTimes(2);
    });

    it('info 级别输出 error + warn + info', () => {
      setLogLevel('info');
      logError('err msg');
      logWarn('warn msg');
      logInfo('info msg');
      logDebug('debug msg');
      expect(stderrSpy).toHaveBeenCalledTimes(3);
    });

    it('debug 级别输出全部', () => {
      setLogLevel('debug');
      logError('err msg');
      logWarn('warn msg');
      logInfo('info msg');
      logDebug('debug msg');
      expect(stderrSpy).toHaveBeenCalledTimes(4);
    });
  });

  describe('logError', () => {
    it('不含 err 参数时只输出 message', () => {
      setLogLevel('error');
      logError('plain message');
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('plain message');
      expect(output).toContain('ERROR');
    });

    it('含 Error 对象时输出 name + message', () => {
      setLogLevel('error');
      const err = new Error('boom');
      logError('wrapped', err);
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('wrapped');
      expect(output).toContain('Error');
      expect(output).toContain('boom');
    });

    it('含字符串错误时输出字符串', () => {
      setLogLevel('error');
      logError('failed', 'some string');
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('some string');
    });

    it('含 null 错误时不崩溃', () => {
      setLogLevel('error');
      expect(() => logError('failed', null)).not.toThrow();
    });
  });

  describe('输出格式', () => {
    it('所有级别都带 [findawheel] 前缀', () => {
      setLogLevel('debug');
      logError('e');
      logWarn('w');
      logInfo('i');
      logDebug('d');
      for (const call of stderrSpy.mock.calls) {
        expect(call[0]).toContain('[findawheel]');
      }
    });

    it('ERROR/WARN/INFO/DEBUG 标签正确', () => {
      setLogLevel('debug');
      logError('e');
      logWarn('w');
      logInfo('i');
      logDebug('d');
      expect(stderrSpy.mock.calls[0][0]).toContain('ERROR');
      expect(stderrSpy.mock.calls[1][0]).toContain('WARN');
      expect(stderrSpy.mock.calls[2][0]).toContain('INFO');
      expect(stderrSpy.mock.calls[3][0]).toContain('DEBUG');
    });
  });
});
