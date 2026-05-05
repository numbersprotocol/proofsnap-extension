/**
 * Numbers Protocol API Manager for Browser Extension
 * Centralized service manager that orchestrates all API services
 */

import { config } from '../config/environment';
import { ApiClient, ApiError } from './ApiClient';
import { AuthService } from './AuthService';
import { indexedDBService } from './IndexedDBService';
import { storageService } from './StorageService';
import { UploadService } from './UploadService';
import { logger } from '../utils/logger';

export class NumbersApiManager {
  private apiClient: ApiClient;
  public auth: AuthService;
  public upload: UploadService;

  constructor() {
    // Initialize API client
    this.apiClient = new ApiClient({
      baseUrl: config.apiUrl,
      timeout: config.timeout,
    });

    // Initialize services with shared API client
    this.auth = new AuthService(this.apiClient);
    this.upload = new UploadService(this.apiClient, indexedDBService, storageService);

    // Clear local auth state whenever the server returns 401 so the UI can
    // prompt the user to log in again instead of failing silently.
    this.apiClient.setOnUnauthenticated(() => {
      logger.warn('Received 401 response – clearing authentication');
      this.clearAuth().catch(err => logger.error('Failed to clear auth after 401:', err));
    });
  }

  /**
   * Login with email and password
   */
  async login(email: string, password: string): Promise<void> {
    const response = await this.auth.login({ email, password });

    if (response.auth_token) {
      // AuthService already set the token on ApiClient
      // Here we just handle persistent storage
      const user = await this.auth.getCurrentUser();
      await storageService.setAuth({
        token: response.auth_token,
        email: user.email,
        username: user.username,
      });
      await this.upload.startProcessing();
    }
  }

  /**
   * Sign up with email and password
   */
  async signup(email: string, password: string, username?: string): Promise<void> {
    const response = await this.auth.signup({ email, password, username });

    if (response.auth_token) {
      // AuthService already set the token on ApiClient
      // Here we just handle persistent storage
      const user = await this.auth.getCurrentUser();
      await storageService.setAuth({
        token: response.auth_token,
        email: user.email,
        username: user.username,
      });
      await this.upload.startProcessing();
    }
  }

  /**
   * Login/Signup with Google
   */
  async loginGoogle(idToken: string): Promise<void> {
    const response = await this.auth.loginGoogle(idToken);

    if (response.auth_token) {
      // AuthService already set the token on ApiClient
      // Here we just handle persistent storage
      const user = await this.auth.getCurrentUser();
      await storageService.setAuth({
        token: response.auth_token,
        email: user.email,
        username: user.username,
      });
      await this.upload.startProcessing();
    }
  }

  /**
   * Clear authentication and remove stored token
   */
  async clearAuth(): Promise<void> {
    await this.auth.clearAuth();
    await storageService.clearAuth();
  }

  /**
   * Set authentication token for all API requests
   * (Internal use - prefer login/signup methods)
   */
  setAuthToken(token: string): void {
    this.auth.setAuthToken(token);
  }

  /**
   * Initialize and restore auth token from storage
   * Validates the token by fetching user data
   */
  async initialize(): Promise<void> {
    try {
      const auth = await storageService.getAuth();
      if (!auth?.token) {
        return;
      }

      // Restore token to API client
      this.auth.setAuthToken(auth.token);

      // Validate token by fetching current user
      try {
        const user = await this.auth.getCurrentUser();

        // Update stored user data with fresh data from server
        await storageService.setAuth({
          token: auth.token,
          email: user.email,
          username: user.username,
        });

        logger.log('Token validated successfully');
      } catch (error: unknown) {
        const statusCode = error instanceof ApiError ? error.statusCode : undefined;
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isNetworkError = errorMessage.includes('network') ||
          errorMessage.includes('timeout') ||
          errorMessage.includes('connection') ||
          statusCode === 0;
        const isServerError = typeof statusCode === 'number' && statusCode >= 500 && statusCode < 600;

        if (isNetworkError || isServerError) {
          // Network or server error - keep the token and use cached user data
          logger.warn('Network/server error during token validation, keeping cached auth:', errorMessage);
        } else {
          // Authentication error (401, 403, etc.) - token is invalid, clear it
          logger.warn('Token validation failed, clearing authentication:', errorMessage);
          await this.clearAuth();
        }
      }
    } catch (error: unknown) {
      logger.error('Failed to initialize authentication:', error);
    }
  }
}

// Lazy singleton pattern
let instance: NumbersApiManager | null = null;

export async function getNumbersApi(): Promise<NumbersApiManager> {
  if (!instance) {
    instance = new NumbersApiManager();
    await instance.initialize();
  }
  return instance;
}
