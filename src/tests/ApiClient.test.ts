/**
 * Unit tests for ApiClient
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient, ApiError } from '../services/ApiClient';

describe('ApiClient', () => {
  let client: ApiClient;

  beforeEach(() => {
    client = new ApiClient({ baseUrl: 'https://api.example.com', timeout: 5000 });
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── constructor ────────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('strips trailing slash from baseUrl', () => {
      const c = new ApiClient({ baseUrl: 'https://api.example.com/' });
      // We verify indirectly: a successful request should hit the correct URL
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ ok: true }),
      });
      vi.stubGlobal('fetch', mockFetch);
      c.getPublic('/test');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/test',
        expect.any(Object)
      );
    });
  });

  // ── auth token ─────────────────────────────────────────────────────────────

  describe('auth token management', () => {
    it('sets and retrieves auth token', () => {
      client.setAuthToken('my-token');
      expect(client.getAuthToken()).toBe('my-token');
    });

    it('clears auth token', () => {
      client.setAuthToken('my-token');
      client.clearAuthToken();
      expect(client.getAuthToken()).toBeUndefined();
    });

    it('includes Authorization header when token is set', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({}),
      });
      vi.stubGlobal('fetch', mockFetch);

      client.setAuthToken('secret');
      await client.getWithAuth('/protected');

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect((options.headers as Record<string, string>)['Authorization']).toBe('token secret');
    });

    it('omits Authorization header when no token is set', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({}),
      });
      vi.stubGlobal('fetch', mockFetch);

      await client.getPublic('/public');

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect((options.headers as Record<string, string>)['Authorization']).toBeUndefined();
    });
  });

  // ── successful requests ────────────────────────────────────────────────────

  describe('successful requests', () => {
    it('returns parsed JSON on success', async () => {
      const data = { id: 1, name: 'test' };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => data,
      }));

      const result = await client.getPublic<typeof data>('/items');
      expect(result).toEqual(data);
    });

    it('returns empty object for non-JSON responses', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'text/html' },
        json: async () => { throw new Error('not JSON'); },
      }));

      const result = await client.getPublic('/page');
      expect(result).toEqual({});
    });

    it('appends query params to URL', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({}),
      });
      vi.stubGlobal('fetch', mockFetch);

      await client.getPublic('/search', { q: 'hello', page: 2 });

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('q=hello');
      expect(url).toContain('page=2');
    });

    it('skips null/undefined query params', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({}),
      });
      vi.stubGlobal('fetch', mockFetch);

      await client.getPublic('/search', { q: null, page: undefined });

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toBe('https://api.example.com/search');
    });
  });

  // ── error handling ─────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('throws ApiError on non-ok HTTP response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ error: { message: 'Resource not found' } }),
      }));

      await expect(client.getPublic('/missing')).rejects.toThrow(ApiError);
    });

    it('populates ApiError with correct status code', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ error: { message: 'Unauthorized' } }),
      }));

      try {
        await client.getPublic('/secure');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).statusCode).toBe(401);
      }
    });

    it('wraps fetch network errors in ApiError with status 0', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

      await expect(client.getPublic('/endpoint')).rejects.toMatchObject({
        name: 'ApiError',
        statusCode: 0,
      });
    });

    it('throws ApiError with status 408 on timeout', async () => {
      // Create an AbortError to simulate timeout
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
        Object.assign(new Error('Aborted'), { name: 'AbortError' })
      ));

      await expect(client.getPublic('/slow')).rejects.toMatchObject({
        name: 'ApiError',
        statusCode: 408,
      });
    });

    it('falls back gracefully when error body is not JSON', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => { throw new Error('invalid json'); },
      }));

      await expect(client.getPublic('/broken')).rejects.toBeInstanceOf(ApiError);
    });
  });

  // ── HTTP method helpers ────────────────────────────────────────────────────

  describe('HTTP method helpers', () => {
    const mockSuccess = () =>
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true }),
      }));

    it('postWithAuth sends POST method', async () => {
      mockSuccess();
      await client.postWithAuth('/items', { name: 'test' });
      const [, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(options.method).toBe('POST');
    });

    it('putWithAuth sends PUT method', async () => {
      mockSuccess();
      await client.putWithAuth('/items/1', { name: 'updated' });
      const [, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(options.method).toBe('PUT');
    });

    it('patchWithAuth sends PATCH method', async () => {
      mockSuccess();
      await client.patchWithAuth('/items/1', { name: 'patched' });
      const [, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(options.method).toBe('PATCH');
    });

    it('deleteWithAuth sends DELETE method', async () => {
      mockSuccess();
      await client.deleteWithAuth('/items/1');
      const [, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(options.method).toBe('DELETE');
    });

    it('postPublic sends POST without auth header', async () => {
      mockSuccess();
      await client.postPublic('/register', { email: 'a@b.com' });
      const [, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(options.method).toBe('POST');
      expect((options.headers as Record<string, string>)['Authorization']).toBeUndefined();
    });
  });

  // ── FormData upload ────────────────────────────────────────────────────────

  describe('FormData handling', () => {
    it('omits Content-Type header for FormData so browser sets multipart boundary', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ id: 'abc' }),
      }));

      const formData = new FormData();
      formData.append('file', new Blob(['data']), 'file.png');

      await client.postWithAuth('/upload', formData);

      const [, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect((options.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    });
  });
});
