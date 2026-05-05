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
  enableLogging: import.meta.env.DEV,
  timeout: 60000,
};

/**
 * Debug helper
 */
export function logEnvironmentInfo() {
  if (config.enableLogging) {
    console.log('🌍 Environment Info:', {
      apiUrl: config.apiUrl,
      enableLogging: config.enableLogging,
      timeout: config.timeout,
    });
  }
}
