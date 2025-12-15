/**
 * Storage Service for Browser Extension
 * Handles small metadata storage using chrome.storage.local
 *
 * Pure storage layer - no dependencies on other services
 *
 * Storage Strategy:
 * - chrome.storage.local (~10MB): Auth tokens, settings, upload queue IDs
 * - Does NOT store large assets (assets handled by IndexedDBService)
 */

export interface StoredAuth {
  token: string;
  email: string;
  username: string;
}

export interface StoredSettings {
  autoUpload: boolean;
  includeLocation: boolean;
  includeTimestamp: boolean;
  includeWebsiteInfo: boolean;
  timestampSize: 'small' | 'medium' | 'large';
  defaultCaptureMode: 'visible' | 'selection' | 'fullpage';
  screenshotFormat: 'png' | 'jpeg';
  screenshotQuality: number;
}

/**
 * Default settings for new installs
 */
const DEFAULT_SETTINGS: StoredSettings = {
  autoUpload: true,
  includeLocation: false,
  includeTimestamp: true,
  includeWebsiteInfo: true,
  timestampSize: 'medium',
  defaultCaptureMode: 'visible',
  screenshotFormat: 'png',
  screenshotQuality: 90,
};

/**
 * Storage Service
 * Manages chrome.storage.local for small data
 */
export class StorageService {
  /**
   * Initialize storage - persist default settings on first run
   */
  async init(): Promise<void> {
    const result = await chrome.storage.local.get('user_settings');
    if (!result.user_settings) {
      await this.setSettings(DEFAULT_SETTINGS);
    }
  }

  // ==========================================
  // Authentication Storage
  // ==========================================

  /**
   * Store authentication data
   */
  async setAuth(auth: StoredAuth): Promise<void> {
    await chrome.storage.local.set({
      auth_token: auth.token,
      auth_email: auth.email,
      auth_username: auth.username,
    });
  }

  /**
   * Get stored authentication data
   */
  async getAuth(): Promise<StoredAuth | null> {
    const result = await chrome.storage.local.get(['auth_token', 'auth_email', 'auth_username']);
    if (result.auth_token) {
      return {
        token: result.auth_token,
        email: result.auth_email,
        username: result.auth_username,
      };
    }
    return null;
  }

  /**
   * Clear authentication data
   */
  async clearAuth(): Promise<void> {
    await chrome.storage.local.remove(['auth_token', 'auth_email', 'auth_username']);
  }

  /**
   * Check if user is authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    const result = await chrome.storage.local.get('auth_token');
    return !!result.auth_token;
  }

  // ==========================================
  // Settings Storage
  // ==========================================

  /**
   * Store user settings
   */
  async setSettings(settings: StoredSettings): Promise<void> {
    await chrome.storage.local.set({ user_settings: JSON.stringify(settings) });
  }

  /**
   * Get user settings
   */
  async getSettings(): Promise<StoredSettings> {
    const result = await chrome.storage.local.get('user_settings');
    if (result.user_settings) {
      return JSON.parse(result.user_settings);
    }
    return DEFAULT_SETTINGS;
  }

  /**
   * Update specific settings
   */
  async updateSettings(updates: Partial<StoredSettings>): Promise<void> {
    const current = await this.getSettings();
    const updated = { ...current, ...updates };
    await this.setSettings(updated);
  }

  // ==========================================
  // Upload Queue Storage (IDs only)
  // ==========================================

  /**
   * Store upload queue IDs
   * Only stores asset IDs, not full asset data (that's in IndexedDB)
   */
  async setUploadQueueIds(assetIds: string[]): Promise<void> {
    await chrome.storage.local.set({ upload_queue: JSON.stringify(assetIds) });
  }

  /**
   * Get upload queue IDs
   */
  async getUploadQueueIds(): Promise<string[]> {
    const result = await chrome.storage.local.get('upload_queue');
    if (result.upload_queue) {
      return JSON.parse(result.upload_queue);
    }
    return [];
  }

  // ==========================================
  // Insufficient Credits Notification Tracking
  // ==========================================

  /**
   * Mark that user has dismissed the insufficient credits notification
   */
  async setInsufficientCreditsNotificationDismissed(dismissed: boolean): Promise<void> {
    await chrome.storage.local.set({ insufficient_credits_dismissed: dismissed });
  }

  /**
   * Check if user has dismissed the insufficient credits notification
   */
  async hasInsufficientCreditsNotificationDismissed(): Promise<boolean> {
    const result = await chrome.storage.local.get('insufficient_credits_dismissed');
    return result.insufficient_credits_dismissed === true;
  }

  /**
   * Clear the dismissal flag when a new insufficient credits error occurs
   * This allows the notification to be shown again even if user previously dismissed it
   */
  async clearInsufficientCreditsNotificationDismissed(): Promise<void> {
    await chrome.storage.local.remove('insufficient_credits_dismissed');
  }

  // ==========================================
  // General Operations
  // ==========================================

  /**
   * Clear all storage (useful for logout)
   */
  async clearAll(): Promise<void> {
    await chrome.storage.local.clear();
  }
}

// Export singleton instance
export const storageService = new StorageService();
