/**
 * Unit tests for StorageService
 */

import { describe, it, expect } from 'vitest';
import { StorageService } from '../services/StorageService';
import type { StoredAuth, StoredSettings } from '../services/StorageService';

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(() => {
    service = new StorageService();
  });

  // ── Authentication ─────────────────────────────────────────────────────────

  describe('authentication', () => {
    const auth: StoredAuth = { token: 'tok123', email: 'a@b.com', username: 'alice' };

    it('stores and retrieves auth data', async () => {
      await service.setAuth(auth);
      const result = await service.getAuth();
      expect(result).toEqual(auth);
    });

    it('returns null when no auth is stored', async () => {
      const result = await service.getAuth();
      expect(result).toBeNull();
    });

    it('reports authenticated after setAuth', async () => {
      await service.setAuth(auth);
      expect(await service.isAuthenticated()).toBe(true);
    });

    it('reports not authenticated after clearAuth', async () => {
      await service.setAuth(auth);
      await service.clearAuth();
      expect(await service.isAuthenticated()).toBe(false);
    });

    it('getAuth returns null after clearAuth', async () => {
      await service.setAuth(auth);
      await service.clearAuth();
      expect(await service.getAuth()).toBeNull();
    });
  });

  // ── Settings ───────────────────────────────────────────────────────────────

  describe('settings', () => {
    it('returns defaults when no settings are stored', async () => {
      const settings = await service.getSettings();
      expect(settings.autoUpload).toBeDefined();
      expect(settings.screenshotFormat).toBe('png');
    });

    it('stores and retrieves custom settings', async () => {
      const custom: StoredSettings = {
        autoUpload: false,
        includeLocation: true,
        includeTimestamp: false,
        includeWebsiteInfo: false,
        timestampSize: 'large',
        timestampFormat: 'compact',
        timestampOpacity: 0.5,
        timestampPosition: 'bottom-right',
        defaultCaptureMode: 'selection',
        screenshotFormat: 'jpeg',
        screenshotQuality: 80,
        huntModeEnabled: false,
        huntModeHashtags: '#test',
        huntModeMessage: 'hello',
      };
      await service.setSettings(custom);
      const result = await service.getSettings();
      expect(result).toEqual(custom);
    });

    it('updateSettings merges with existing settings', async () => {
      await service.updateSettings({ autoUpload: false });
      const result = await service.getSettings();
      // Only autoUpload should change; all other fields keep defaults
      expect(result.autoUpload).toBe(false);
      expect(result.screenshotFormat).toBe('png');
    });

    it('new fields get default values when reading older saved settings', async () => {
      // Simulate stored settings missing a field (e.g., huntModeEnabled)
      const partial = { autoUpload: true, screenshotFormat: 'jpeg' };
      await chrome.storage.local.set({ user_settings: JSON.stringify(partial) });
      const result = await service.getSettings();
      // huntModeEnabled should fall back to the default value
      expect(result.huntModeEnabled).toBe(false);
    });
  });

  // ── Upload queue ───────────────────────────────────────────────────────────

  describe('upload queue', () => {
    it('returns empty array when queue is unset', async () => {
      const ids = await service.getUploadQueueIds();
      expect(ids).toEqual([]);
    });

    it('stores and retrieves upload queue IDs', async () => {
      await service.setUploadQueueIds(['id1', 'id2', 'id3']);
      const ids = await service.getUploadQueueIds();
      expect(ids).toEqual(['id1', 'id2', 'id3']);
    });

    it('overwrites previous queue on subsequent setUploadQueueIds calls', async () => {
      await service.setUploadQueueIds(['id1', 'id2']);
      await service.setUploadQueueIds(['id3']);
      const ids = await service.getUploadQueueIds();
      expect(ids).toEqual(['id3']);
    });
  });

  // ── Insufficient credits notification ──────────────────────────────────────

  describe('insufficient credits notification', () => {
    it('is not dismissed by default', async () => {
      expect(await service.hasInsufficientCreditsNotificationDismissed()).toBe(false);
    });

    it('records dismissal', async () => {
      await service.setInsufficientCreditsNotificationDismissed(true);
      expect(await service.hasInsufficientCreditsNotificationDismissed()).toBe(true);
    });

    it('clearInsufficientCreditsNotificationDismissed removes the flag', async () => {
      await service.setInsufficientCreditsNotificationDismissed(true);
      await service.clearInsufficientCreditsNotificationDismissed();
      expect(await service.hasInsufficientCreditsNotificationDismissed()).toBe(false);
    });
  });

  // ── Google auth error ──────────────────────────────────────────────────────

  describe('Google auth error', () => {
    it('returns null when no error is stored', async () => {
      expect(await service.getAndClearGoogleAuthError()).toBeNull();
    });

    it('stores and retrieves google auth error', async () => {
      await service.setGoogleAuthError('access_denied');
      expect(await service.getAndClearGoogleAuthError()).toBe('access_denied');
    });

    it('clears the error after retrieval', async () => {
      await service.setGoogleAuthError('access_denied');
      await service.getAndClearGoogleAuthError();
      expect(await service.getAndClearGoogleAuthError()).toBeNull();
    });
  });

  // ── Pending hunt share ─────────────────────────────────────────────────────

  describe('pending hunt share', () => {
    it('returns null when no pending share', async () => {
      expect(await service.getAndClearPendingShare()).toBeNull();
    });

    it('stores and retrieves pending share NID', async () => {
      await service.setPendingShare('nid-abc-123');
      expect(await service.getAndClearPendingShare()).toBe('nid-abc-123');
    });

    it('clears the pending share after retrieval', async () => {
      await service.setPendingShare('nid-abc-123');
      await service.getAndClearPendingShare();
      expect(await service.getAndClearPendingShare()).toBeNull();
    });
  });

  // ── clearAll ───────────────────────────────────────────────────────────────

  describe('clearAll', () => {
    it('removes all stored data', async () => {
      await service.setAuth({ token: 't', email: 'e@e.com', username: 'u' });
      await service.setUploadQueueIds(['id1']);
      await service.clearAll();
      expect(await service.getAuth()).toBeNull();
      expect(await service.getUploadQueueIds()).toEqual([]);
    });
  });

  // ── init ──────────────────────────────────────────────────────────────────

  describe('init', () => {
    it('persists default settings on first run', async () => {
      await service.init();
      const settings = await service.getSettings();
      expect(settings.autoUpload).toBe(true);
    });

    it('does not overwrite existing settings on subsequent runs', async () => {
      await service.updateSettings({ autoUpload: false });
      await service.init();
      const settings = await service.getSettings();
      expect(settings.autoUpload).toBe(false);
    });
  });
});
