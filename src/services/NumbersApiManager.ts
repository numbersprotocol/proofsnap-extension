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
   * Delete user account permanently and clear all stored auth data
   */
  async deleteAccount(): Promise<void> {
    await this.auth.deleteAccount();
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

        console.log('Token validated successfully for user:', user.email);
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
          console.warn('Network/server error during token validation, keeping cached auth:', errorMessage);
        } else {
          // Authentication error (401, 403, etc.) - token is invalid, clear it
          console.warn('Token validation failed, clearing authentication:', errorMessage);
          await this.clearAuth();
        }
      }
    } catch (error: unknown) {
      console.error('Failed to initialize authentication:', error);
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
