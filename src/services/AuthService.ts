/**
 * Authentication Service for ProofSnap Extension
 * Handles user login, signup, and token management
 */
import { ApiClient } from './ApiClient';
import { createLogger } from '../utils/logger';

const logger = createLogger('AuthService');

type LoginRequest = { email: string; password: string };
type LoginResponse = { auth_token: string };
type SignupRequest = {
  username?: string;
  email: string;
  password: string;
  referral_code?: string;
  activation_method?: 'skip' | 'legacy' | 'code';
};
type SignupResponse = { auth_token: string };
type ResetPasswordRequest = { email: string };
type CustomUser = {
  id: number;
  username: string;
  email: string;
  address?: string;
  [key: string]: any;
};
type UserUpdateRequest = {
  language?: string;
  default_tag?: string;
  allow_c2pa_download?: boolean;
};

/**
 * Authentication Service
 * Manages user authentication and session state
 */
export class AuthService {
  private apiClient: ApiClient;

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  /**
   * Login with email and password
   */
  async login(credentials: LoginRequest): Promise<LoginResponse> {
    const response = await this.apiClient.postPublic<LoginResponse>(
      '/auth/token/login/',
      credentials
    );

    // Store the auth token in the API client
    if (response.auth_token) {
      this.apiClient.setAuthToken(response.auth_token);
    }

    return response;
  }

  /**
   * Sign up with email and password
   */
  async signup(signupData: SignupRequest): Promise<SignupResponse> {
    const response = await this.apiClient.postPublic<SignupResponse>(
      '/auth/users/',
      signupData
    );

    // Store the auth token in the API client if provided
    if (response.auth_token) {
      this.apiClient.setAuthToken(response.auth_token);
    }

    return response;
  }

  /**
   * Authenticate with Google using Chrome Identity API to get an ID Token
   * Note: The backend requires an OIDC ID Token (JWT), not an OAuth2 Access Token.
   * Therefore we must use launchWebAuthFlow with response_type=id_token.
   */
  async authenticateWithGoogle(): Promise<string> {
    const manifest = chrome.runtime.getManifest();
    const clientId = manifest.oauth2?.client_id;

    if (!clientId) {
      throw new Error('Google Client ID is missing in manifest.json');
    }

    const redirectUri = chrome.identity.getRedirectURL(); // e.g., https://<app-id>.chromiumapp.org/

    const scopes = 'openid email profile';
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');

    // Generate cryptographically secure nonce
    const array = new Uint32Array(4);
    crypto.getRandomValues(array);
    const nonce = Array.from(array, dec => dec.toString(36)).join('');

    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('response_type', 'id_token');
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', scopes);
    authUrl.searchParams.set('nonce', nonce); // secure nonce
    authUrl.searchParams.set('prompt', 'select_account'); // force selection to ensure fresh login if needed

    return new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow(
        {
          url: authUrl.toString(),
          interactive: true,
        },
        (responseUrl) => {
          if (chrome.runtime.lastError || !responseUrl) {
            reject(chrome.runtime.lastError?.message || 'Google Auth failed or canceled');
            return;
          }

          // Parse id_token from the hash fragment of the response URL
          const url = new URL(responseUrl);
          const params = new URLSearchParams(url.hash.substring(1)); // remove leading #
          const idToken = params.get('id_token');

          if (idToken) {
            resolve(idToken);
          } else {
            logger.error('No id_token found in response', { responseUrl });
            reject('Failed to retrieve ID token from Google');
          }
        }
      );
    });
  }

  /**
   * Login/Signup with Google
   */
  async loginGoogle(idToken: string): Promise<SignupResponse> {
    // The backend endpoint /auth/users/signup-google/ handles both login and signup
    const response = await this.apiClient.postPublic<SignupResponse>(
      '/auth/users/signup-google/',
      { id_token: idToken }
    );

    if (response.auth_token) {
      this.apiClient.setAuthToken(response.auth_token);
    }

    return response;
  }

  /**
   * Request password reset
   */
  async resetPassword(resetData: ResetPasswordRequest): Promise<void> {
    await this.apiClient.postPublic('/auth/users/reset_password/', resetData);
  }

  /**
   * Get current user profile
   */
  async getCurrentUser(): Promise<CustomUser> {
    return await this.apiClient.getWithAuth<CustomUser>('/auth/users/me/');
  }

  /**
   * Update user data (config and profile)
   */
  async updateUser(userData: UserUpdateRequest): Promise<CustomUser> {
    return await this.apiClient.patchWithAuth<CustomUser>('/auth/users/me/', userData);
  }

  /**
   * Delete user account permanently
   */
  async deleteAccount(): Promise<void> {
    await this.apiClient.deleteWithAuth('/auth/users/me/');
    this.clearAuth();
  }

  /**
   * Check if user is currently authenticated
   */
  isAuthenticated(): boolean {
    return !!this.apiClient.getAuthToken();
  }

  /**
   * Get current auth token
   */
  getAuthToken(): string | undefined {
    return this.apiClient.getAuthToken();
  }

  /**
   * Set auth token manually (for token restoration)
   */
  setAuthToken(token: string): void {
    this.apiClient.setAuthToken(token);
  }

  /**
   * Clear authentication token from API client
   */
  async clearAuth(): Promise<void> {
    this.apiClient.clearAuthToken();
  }
}
