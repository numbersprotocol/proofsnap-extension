/**
 * Environment Configuration for Browser Extension
 * Uses Vite's import.meta.env for environment-specific settings.
 * Define VITE_API_URL and VITE_ENABLE_LOGGING in .env.development or
 * .env.production to override the defaults below.
 */

export interface EnvironmentConfig {
  apiUrl: string;
  enableLogging: boolean;
  timeout: number;
}

function resolveEnableLogging(): boolean {
  if (import.meta.env.VITE_ENABLE_LOGGING !== undefined) {
    return import.meta.env.VITE_ENABLE_LOGGING === 'true';
  }
  // Default: enable logging only in development mode
  return import.meta.env.DEV === true;
}

// Static configuration for browser extension
export const config: EnvironmentConfig = {
  apiUrl: (import.meta.env.VITE_API_URL as string | undefined) ?? 'https://api.numbersprotocol.io/api/v3',
  enableLogging: resolveEnableLogging(),
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
