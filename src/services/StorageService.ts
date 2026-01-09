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
  timestampFormat: 'full' | 'compact' | 'time-only';
  timestampOpacity: number; // 0.3 to 1.0
  timestampPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  defaultCaptureMode: 'visible' | 'selection' | 'fullpage';
  screenshotFormat: 'png' | 'jpeg';
  screenshotQuality: number;
  // Hunt Mode settings
  huntModeEnabled: boolean;
  huntModeHashtags: string;
  huntModeMessage: string;
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
  timestampFormat: 'full',
  timestampOpacity: 1.0,
  timestampPosition: 'top-left',
  defaultCaptureMode: 'visible',
  screenshotFormat: 'png',
  screenshotQuality: 90,
  // Hunt Mode defaults
  huntModeEnabled: false,
  huntModeHashtags: '#ProofSnapHunt #AIHunt',
  huntModeMessage: '🎯 I spotted this satisfying!',
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
   * Merges saved settings with defaults to ensure new fields are always present
   */
  async getSettings(): Promise<StoredSettings> {
    const result = await chrome.storage.local.get('user_settings');
    if (result.user_settings) {
      const saved = JSON.parse(result.user_settings);
      // Merge with defaults to ensure new fields are present
      return { ...DEFAULT_SETTINGS, ...saved };
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
  // Google Auth Error Persistence
  // ==========================================

  /**
   * Set Google Auth Error message
   */
  async setGoogleAuthError(message: string): Promise<void> {
    await chrome.storage.local.set({ google_auth_error: message });
  }

  /**
   * Get and clear Google Auth Error message
   */
  async getAndClearGoogleAuthError(): Promise<string | null> {
    const result = await chrome.storage.local.get('google_auth_error');
    if (result.google_auth_error) {
      await chrome.storage.local.remove('google_auth_error');
      return result.google_auth_error;
    }
    return null;
  }

  // ==========================================
  // Hunt Mode Pending Share
  // ==========================================

  /**
   * Store a pending share prompt (for when upload completes while popup is closed)
   */
  async setPendingShare(nid: string): Promise<void> {
    await chrome.storage.local.set({ pending_hunt_share: nid });
  }

  /**
   * Get and clear pending share prompt
   */
  async getAndClearPendingShare(): Promise<string | null> {
    const result = await chrome.storage.local.get('pending_hunt_share');
    if (result.pending_hunt_share) {
      await chrome.storage.local.remove('pending_hunt_share');
      return result.pending_hunt_share;
    }
    return null;
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
