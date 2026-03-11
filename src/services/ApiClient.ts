/**
 * HTTP Client Service for Numbers Protocol API
 * Uses native fetch API for HTTP requests
 */

export interface RequestConfig {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  params?: Record<string, unknown>;
}

export interface ApiClientConfig {
  baseUrl: string;
  timeout?: number;
}

/**
 * Custom API Error class
 */
export class ApiError extends Error {
  statusCode: number;
  data?: unknown;

  constructor(message: string, statusCode: number, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.data = data;
  }
}

/**
 * API Client for Numbers Protocol
 * Handles all HTTP communication with proper authentication
 */
export class ApiClient {
  private baseUrl: string;
  private timeout: number;
  private authToken?: string;

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.timeout = config.timeout || 30000;
  }

  /**
   * Set authentication token for subsequent requests
   */
  setAuthToken(token: string) {
    this.authToken = token;
  }

  /**
   * Clear authentication token
   */
  clearAuthToken() {
    this.authToken = undefined;
  }

  /**
   * Get current authentication token
   */
  getAuthToken(): string | undefined {
    return this.authToken;
  }

  /**
   * Build headers for API requests with authentication token
   */
  private buildAuthHeaders(customHeaders?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...customHeaders,
    };

    // Add authentication header
    if (this.authToken) {
      headers['Authorization'] = `token ${this.authToken}`;
    }

    return headers;
  }

  /**
   * Build headers for public API requests (no authentication)
   */
  private buildPublicHeaders(customHeaders?: Record<string, string>): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...customHeaders,
    };
  }

  /**
   * Build URL with query parameters
   */
  private buildUrl(endpoint: string, params?: Record<string, any>): string {
    const url = `${this.baseUrl}${endpoint}`;

    if (!params || Object.keys(params).length === 0) {
      return url;
    }

    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    });

    const queryString = searchParams.toString();
    return queryString ? `${url}?${queryString}` : url;
  }

  /**
   * Make HTTP request
   */
  async request<T>(endpoint: string, config: RequestConfig = {}): Promise<T> {
    const {
      method = 'GET',
      headers,
      body,
      params,
    } = config;

    const url = this.buildUrl(endpoint, params);

    // Handle FormData for file uploads
    let requestBody: BodyInit | undefined;
    const requestHeaders = { ...headers };

    if (body instanceof FormData) {
      // Remove Content-Type header to let browser set it with boundary
      delete requestHeaders['Content-Type'];
      requestBody = body;
    } else if (body && typeof body === 'object') {
      requestBody = JSON.stringify(body);
    } else if (typeof body === 'string') {
      requestBody = body;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: requestBody,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({
          error: {
            type: 'http_error',
            message: `HTTP ${response.status}: ${response.statusText}`,
            details: 'Failed to parse error response',
          },
          status_code: response.status,
        }));

        throw new ApiError(
          errorData.error?.message || 'Request failed',
          response.status,
          errorData
        );
      }

      // Handle empty responses
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        return {} as T;
      }

      return await response.json();
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }

      const err = error instanceof Error ? error : new Error('Unknown error');
      if (err.name === 'AbortError') {
        throw new ApiError('Request timeout', 408);
      }

      throw new ApiError(
        err.message || 'Network error occurred',
        0,
        { error: { type: 'network_error', message: err.message || 'Unknown error', details: '' } }
      );
    }
  }

  /**
   * Make HTTP request with token authentication only
   */
  async requestWithAuth<T>(endpoint: string, config: RequestConfig = {}): Promise<T> {
    const modifiedConfig = {
      ...config,
      headers: this.buildAuthHeaders(config.headers)
    };
    return this.request<T>(endpoint, modifiedConfig);
  }


  /**
   * Make HTTP request without authentication (public endpoints)
   */
  async requestPublic<T>(endpoint: string, config: RequestConfig = {}): Promise<T> {
    const modifiedConfig = {
      ...config,
      headers: this.buildPublicHeaders(config.headers)
    };
    return this.request<T>(endpoint, modifiedConfig);
  }

  // ==========================================
  // Authentication-specific convenience methods
  // ==========================================

  /**
   * GET request with token authentication only
   */
  async getWithAuth<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    return this.requestWithAuth<T>(endpoint, {
      method: 'GET',
      params
    });
  }

  /**
   * POST request with token authentication only
   */
  async postWithAuth<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.requestWithAuth<T>(endpoint, {
      method: 'POST',
      body
    });
  }

  /**
   * PUT request with token authentication only
   */
  async putWithAuth<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.requestWithAuth<T>(endpoint, {
      method: 'PUT',
      body
    });
  }

  /**
   * PATCH request with token authentication only
   */
  async patchWithAuth<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.requestWithAuth<T>(endpoint, {
      method: 'PATCH',
      body
    });
  }

  /**
   * DELETE request with token authentication only
   */
  async deleteWithAuth<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    return this.requestWithAuth<T>(endpoint, {
      method: 'DELETE',
      params
    });
  }

  // ==========================================
  // Public API convenience methods
  // ==========================================

  /**
   * GET request for public endpoints
   */
  async getPublic<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    return this.requestPublic<T>(endpoint, {
      method: 'GET',
      params
    });
  }

  /**
   * POST request for public endpoints
   */
  async postPublic<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.requestPublic<T>(endpoint, {
      method: 'POST',
      body
    });
  }
}
