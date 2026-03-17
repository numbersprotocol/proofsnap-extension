/**
 * Environment Configuration for Browser Extension
 * Browser-compatible version without process.env
 */

export interface EnvironmentConfig {
  apiUrl: string;
  enableLogging: boolean;
  timeout: number;
}

// Static configuration for browser extension
export const config: EnvironmentConfig = {
  apiUrl: 'https://api.numbersprotocol.io/api/v3',
  enableLogging: true,
  timeout: 60000,
};

/**
 * Debug helper — logs environment configuration at INFO level.
 * Import the logger lazily to avoid a circular-dependency edge case.
 */
export function logEnvironmentInfo() {
  if (config.enableLogging) {
    import('../utils/logger')
      .then(({ createLogger }) => {
        const logger = createLogger('Environment');
        logger.info('Environment Info', {
          apiUrl: config.apiUrl,
          enableLogging: config.enableLogging,
          timeout: config.timeout,
        });
      })
      .catch(() => {
        // Fallback if logger module fails to load
        console.info('[Environment] Environment Info:', {
          apiUrl: config.apiUrl,
          enableLogging: config.enableLogging,
          timeout: config.timeout,
        });
      });
  }
}
