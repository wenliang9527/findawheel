import { vi } from 'vitest';

vi.mock('../src/util/logger.js', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  logDebug: vi.fn(),
  setLogLevel: vi.fn(),
}));
