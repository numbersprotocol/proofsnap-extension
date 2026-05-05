/**
 * Centralized logging utility
 * Only logs in development mode and redacts sensitive fields.
 */

const isEnabled = import.meta.env.DEV;

const SENSITIVE_KEYS = new Set(['dataUrl', 'password', 'token', 'accessToken', 'refreshToken']);

function redact(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    result[k] = SENSITIVE_KEYS.has(k) ? '[REDACTED]' : redact(v);
  }
  return result;
}

function sanitize(args: unknown[]): unknown[] {
  return args.map(redact);
}

export const logger = {
  log(...args: unknown[]): void {
    if (isEnabled) console.log(...sanitize(args));
  },
  warn(...args: unknown[]): void {
    if (isEnabled) console.warn(...sanitize(args));
  },
  error(...args: unknown[]): void {
    if (isEnabled) console.error(...sanitize(args));
  },
};

/**
 * Validate an asset NID (Numbers ID) value.
 * Accepts only alphanumeric characters, hyphens, and underscores to prevent
 * path-traversal and URL injection attacks.
 */
const NID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function validateNid(nid: string | null | undefined): nid is string {
  if (!nid) return false;
  return NID_PATTERN.test(nid);
}
