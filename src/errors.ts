// src/errors.ts
export class SourceError extends Error {
  constructor(public source: string, message: string) {
    super(`[${source}] ${message}`);
    this.name = 'SourceError';
  }
}

export class RateLimitError extends SourceError {
  constructor(source: string, public resetAt: Date) {
    super(source, `rate limited, resets at ${resetAt.toISOString()}`);
    this.name = 'RateLimitError';
  }
}
