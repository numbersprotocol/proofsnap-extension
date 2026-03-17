/**
 * Structured Logger for ProofSnap Extension
 *
 * Provides levelled, module-scoped logging with timestamps.
 * - Development builds: DEBUG level (all messages shown)
 * - Production builds:  INFO level (debug messages suppressed)
 *
 * Usage:
 *   import { createLogger } from '@/utils/logger';
 *   const logger = createLogger('MyModule');
 *   logger.debug('Verbose detail', { key: 'value' });
 *   logger.info('Something happened');
 *   logger.warn('Unexpected condition', { detail });
 *   logger.error('Operation failed', error, { assetId });
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
};

/**
 * Minimum log level.
 * In development (Vite dev / watch mode) all levels are shown.
 * In production builds only INFO and above are shown.
 */
const MIN_LEVEL: LogLevel = import.meta.env.DEV ? LogLevel.DEBUG : LogLevel.INFO;

export class Logger {
  constructor(private readonly module: string) {}

  debug(msg: string, context?: Record<string, unknown>): void {
    this.emit(LogLevel.DEBUG, msg, undefined, context);
  }

  info(msg: string, context?: Record<string, unknown>): void {
    this.emit(LogLevel.INFO, msg, undefined, context);
  }

  warn(msg: string, context?: Record<string, unknown>): void {
    this.emit(LogLevel.WARN, msg, undefined, context);
  }

  error(msg: string, error?: unknown, context?: Record<string, unknown>): void {
    this.emit(LogLevel.ERROR, msg, error, context);
  }

  private emit(
    level: LogLevel,
    msg: string,
    error?: unknown,
    context?: Record<string, unknown>,
  ): void {
    if (level < MIN_LEVEL) return;

    const timestamp = new Date().toISOString();
    const label = LEVEL_LABELS[level];
    const prefix = `[${timestamp}] [${label}] [${this.module}]`;
    const parts: unknown[] = [`${prefix} ${msg}`];

    if (context !== undefined) parts.push(context);
    if (error !== undefined) parts.push(error);

    switch (level) {
      case LogLevel.DEBUG:
      case LogLevel.INFO:
        console.log(...parts);
        break;
      case LogLevel.WARN:
        console.warn(...parts);
        break;
      case LogLevel.ERROR:
        console.error(...parts);
        break;
    }
  }
}

/**
 * Factory function — creates a Logger scoped to the given module name.
 */
export function createLogger(module: string): Logger {
  return new Logger(module);
}
