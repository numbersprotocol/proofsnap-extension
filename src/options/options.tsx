/**
 * Options/Settings Page
 * Full-featured settings and authentication page
 */

import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { storageService, StoredSettings } from '../services/StorageService';
import './options.css';

/**
 * Watermark Settings Component
 */
function WatermarkSettings({
  settings,
  onSave,
}: {
  settings: StoredSettings;
  onSave: (updates: Partial<StoredSettings>) => void;
}) {
  return (
    <section className="settings-section">
      <h2>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8, verticalAlign: 'text-bottom' }} aria-hidden="true">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
        Timestamp Watermark
      </h2>

      <div className="setting-item">
        <div className="setting-header">
          <label htmlFor="includeTimestamp">Show timestamp on snaps</label>
          <input
            id="includeTimestamp"
            type="checkbox"
            checked={settings.includeTimestamp}
            onChange={(e) => onSave({ includeTimestamp: e.target.checked })}
            className="toggle-switch"
          />
        </div>
        <p className="setting-description">
          Add a timestamp watermark to your snaps
        </p>
      </div>

      <div className="setting-item">
        <label htmlFor="timestampFormat">Timestamp format</label>
        <select
          id="timestampFormat"
          value={settings.timestampFormat}
          onChange={(e) => onSave({ timestampFormat: e.target.value as 'full' | 'compact' | 'time-only' })}
          disabled={!settings.includeTimestamp}
          className="select-input"
        >
          <option value="full">Full (Time + Date + Day)</option>
          <option value="compact">Compact (Time + Short Date)</option>
          <option value="time-only">Time Only</option>
        </select>
        <p className="setting-description">
          Choose how much information to display
        </p>
      </div>

      <div className="setting-item">
        <label htmlFor="timestampSize">Timestamp size</label>
        <select
          id="timestampSize"
          value={settings.timestampSize}
          onChange={(e) => onSave({ timestampSize: e.target.value as 'small' | 'medium' | 'large' })}
          disabled={!settings.includeTimestamp}
          className="select-input"
        >
          <option value="small">Small</option>
          <option value="medium">Medium (Default)</option>
          <option value="large">Large</option>
        </select>
        <p className="setting-description">
          Adjust the size of the timestamp watermark
        </p>
      </div>

      <div className="setting-item">
        <label htmlFor="timestampPosition">Timestamp position</label>
        <select
          id="timestampPosition"
          value={settings.timestampPosition}
          onChange={(e) => onSave({ timestampPosition: e.target.value as 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' })}
          disabled={!settings.includeTimestamp}
          className="select-input"
        >
          <option value="top-left">Top Left</option>
          <option value="top-right">Top Right</option>
          <option value="bottom-left">Bottom Left</option>
          <option value="bottom-right">Bottom Right</option>
        </select>
        <p className="setting-description">
          Choose where to place the timestamp on the screenshot
        </p>
      </div>

      <div className="setting-item">
        <label htmlFor="timestampOpacity">
          Timestamp opacity: {Math.round((settings.timestampOpacity ?? 1) * 100)}%
        </label>
        <input
          id="timestampOpacity"
          type="range"
          min="0"
          max="100"
          value={Math.round((settings.timestampOpacity ?? 1) * 100)}
          onChange={(e) => onSave({ timestampOpacity: parseInt(e.target.value) / 100 })}
          disabled={!settings.includeTimestamp}
          className="range-input"
        />
        <p className="setting-description">
          Adjust transparency (0% = invisible, 100% = fully visible)
        </p>
      </div>
    </section>
  );
}

/**
 * Website Info Settings Component
 */
function WebsiteInfoSettings({
  settings,
  onSave,
}: {
  settings: StoredSettings;
  onSave: (updates: Partial<StoredSettings>) => void;
}) {
  return (
    <section className="settings-section">
      <h2>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8, verticalAlign: 'text-bottom' }} aria-hidden="true">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="2" y1="12" x2="22" y2="12"></line>
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
        </svg>
        Website Information
      </h2>

      <div className="setting-item">
        <div className="setting-header">
          <label htmlFor="includeWebsiteInfo">Include website source</label>
          <input
            id="includeWebsiteInfo"
            type="checkbox"
            checked={settings.includeWebsiteInfo}
            onChange={(e) => onSave({ includeWebsiteInfo: e.target.checked })}
            className="toggle-switch"
          />
        </div>
        <p className="setting-description">
          Capture and store the URL, page title, and domain of the website where the snap was taken.
          This information will be included in the blockchain metadata for verification.
        </p>
      </div>
    </section>
  );
}

/**
 * Location Settings Component
 * Allows user to enable/disable geolocation capture
 */
function LocationSettings({
  settings,
  onSave,
}: {
  settings: StoredSettings;
  onSave: (updates: Partial<StoredSettings>) => void;
}) {
  const [permissionStatus, setPermissionStatus] = useState<'granted' | 'denied' | 'prompt' | 'unknown'>('unknown');

  useEffect(() => {
    // Check geolocation permission status
    if (navigator.permissions) {
      navigator.permissions.query({ name: 'geolocation' }).then((result) => {
        setPermissionStatus(result.state);
        result.onchange = () => setPermissionStatus(result.state);
      }).catch(() => {
        setPermissionStatus('unknown');
      });
    }
  }, []);

  const handleEnableLocation = async (enabled: boolean) => {
    if (enabled) {
      // Request permission by triggering a geolocation request
      try {
        await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
          });
        });
        setPermissionStatus('granted');
        onSave({ includeLocation: true });
      } catch (error) {
        setPermissionStatus('denied');
        alert('Location permission was denied. Please enable it in your browser settings to use this feature.');
      }
    } else {
      onSave({ includeLocation: false });
    }
  };

  return (
    <section className="settings-section">
      <h2>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8, verticalAlign: 'text-bottom' }} aria-hidden="true">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
          <circle cx="12" cy="10" r="3"></circle>
        </svg>
        Location
      </h2>

      <div className="setting-item">
        <div className="setting-header">
          <label htmlFor="includeLocation">Include location in metadata</label>
          <input
            id="includeLocation"
            type="checkbox"
            checked={settings.includeLocation}
            onChange={(e) => handleEnableLocation(e.target.checked)}
            className="toggle-switch"
          />
        </div>
        <p className="setting-description">
          Capture your current GPS coordinates when taking a snap.
          This information is stored in the blockchain metadata for verification purposes and is not visible on the screenshot.
        </p>
        {permissionStatus === 'denied' && settings.includeLocation && (
          <p className="setting-warning" style={{ color: '#ef4444', marginTop: '8px' }}>
            ⚠️ Location permission is denied. Please enable it in your browser settings.
          </p>
        )}
        {permissionStatus === 'granted' && settings.includeLocation && (
          <p className="setting-success" style={{ color: '#22c55e', marginTop: '8px' }}>
            ✓ Location permission granted
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * Capture Settings Component
 */
function CaptureSettings({
  settings,
  onSave,
}: {
  settings: StoredSettings;
  onSave: (updates: Partial<StoredSettings>) => void;
}) {
  return (
    <section className="settings-section">
      <h2>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8, verticalAlign: 'text-bottom' }} aria-hidden="true">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
          <circle cx="12" cy="13" r="4"></circle>
        </svg>
        Capture Settings
      </h2>

      {/* TODO: Implement capture mode selection in future
      <div className="setting-item">
        <label htmlFor="defaultCaptureMode">Default capture mode</label>
        <select
          id="defaultCaptureMode"
          value={settings.defaultCaptureMode}
          onChange={(e) => onSave({ defaultCaptureMode: e.target.value as any })}
          className="select-input"
        >
          <option value="visible">Visible Tab (Current View)</option>
          <option value="selection">Selection Area</option>
          <option value="fullpage">Full Page</option>
        </select>
        <p className="setting-description">
          Choose how snaps are captured by default
        </p>
      </div>
      */}

      <div className="setting-item">
        <label htmlFor="screenshotFormat">Image format</label>
        <select
          id="screenshotFormat"
          value={settings.screenshotFormat}
          onChange={(e) => onSave({ screenshotFormat: e.target.value as 'png' | 'jpeg' })}
          className="select-input"
        >
          <option value="png">PNG (Lossless)</option>
          <option value="jpeg">JPEG (Compressed)</option>
        </select>
        <p className="setting-description">
          PNG preserves quality, JPEG creates smaller files
        </p>
      </div>

      {settings.screenshotFormat === 'jpeg' && (
        <div className="setting-item">
          <label htmlFor="screenshotQuality">
            JPEG Quality: {settings.screenshotQuality}%
          </label>
          <input
            id="screenshotQuality"
            type="range"
            min="50"
            max="100"
            value={settings.screenshotQuality}
            onChange={(e) => onSave({ screenshotQuality: parseInt(e.target.value) })}
            className="range-input"
          />
          <p className="setting-description">
            Higher quality = larger file size
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * Hunt Mode Settings Component
 * Special sharing mode for AI Hunt events
 */
function HuntModeSettings({
  settings,
  onSave,
}: {
  settings: StoredSettings;
  onSave: (updates: Partial<StoredSettings>) => void;
}) {
  return (
    <section className="settings-section hunt-mode-section">
      <h2>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8, verticalAlign: 'text-bottom' }} aria-hidden="true">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
          <line x1="2" y1="12" x2="22" y2="12"></line>
        </svg>
        🎯 Hunt Mode
      </h2>

      <div className="hunt-mode-banner">
        <p>
          <strong>AI Hunt Event!</strong> Enable Hunt Mode to get share buttons after each snap.
          Share your ProofSnap captures on X to participate in the event!
        </p>
      </div>

      <div className="setting-item">
        <div className="setting-header">
          <label htmlFor="huntModeEnabled">Enable Hunt Mode</label>
          <input
            id="huntModeEnabled"
            type="checkbox"
            checked={settings.huntModeEnabled}
            onChange={(e) => onSave({ huntModeEnabled: e.target.checked })}
            className="toggle-switch"
          />
        </div>
        <p className="setting-description">
          Show share buttons after each successful upload
        </p>
      </div>

      {settings.huntModeEnabled && (
        <>
          <div className="setting-item">
            <label htmlFor="huntModeMessage">Share message</label>
            <input
              id="huntModeMessage"
              type="text"
              value={settings.huntModeMessage}
              onChange={(e) => onSave({ huntModeMessage: e.target.value })}
              className="text-input"
              placeholder="🎯 I spotted this!"
            />
            <p className="setting-description">
              Custom message for your shares (appears before the link)
            </p>
          </div>

          <div className="setting-item">
            <label htmlFor="huntModeHashtags">Hashtags</label>
            <input
              id="huntModeHashtags"
              type="text"
              value={settings.huntModeHashtags}
              onChange={(e) => onSave({ huntModeHashtags: e.target.value })}
              className="text-input"
              placeholder="#ProofSnapHunt #AIHunt"
            />
            <p className="setting-description">
              Hashtags to include in your shares
            </p>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Upload Settings Component
 */
function UploadSettings({
  settings,
  onSave,
}: {
  settings: StoredSettings;
  onSave: (updates: Partial<StoredSettings>) => void;
}) {
  return (
    <section className="settings-section">
      <h2>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8, verticalAlign: 'text-bottom' }} aria-hidden="true">
          <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path>
        </svg>
        Upload Settings
      </h2>

      <div className="setting-item">
        <div className="setting-header">
          <label htmlFor="autoUpload">Auto-upload after capture</label>
          <input
            id="autoUpload"
            type="checkbox"
            checked={settings.autoUpload}
            onChange={(e) => onSave({ autoUpload: e.target.checked })}
            className="toggle-switch"
          />
        </div>
        <p className="setting-description">
          Automatically upload and create cryptographic proof after capture
        </p>
      </div>
    </section>
  );
}

/**
 * Main Options App Component
 */
function OptionsApp() {
  const [settings, setSettings] = useState<StoredSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const storedSettings = await storageService.getSettings();
      setSettings(storedSettings);
    } catch (error) {
      console.error('Failed to load settings:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveSettings(updates: Partial<StoredSettings>) {
    if (!settings) return;

    try {
      const newSettings = { ...settings, ...updates };
      await storageService.setSettings(newSettings);
      setSettings(newSettings);

      // Show success message briefly
      const savedMessage = document.querySelector('.saved-message');
      if (savedMessage) {
        savedMessage.classList.add('show');
        setTimeout(() => savedMessage.classList.remove('show'), 2000);
      }
    } catch (error) {
      console.error('Failed to save settings:', error);
      alert('Failed to save settings');
    }
  }

  if (loading) {
    return (
      <div className="options-container">
        <div className="loading">Loading settings...</div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="options-container">
        <div className="error">Failed to load settings</div>
      </div>
    );
  }

  return (
    <div className="options-container">
      <header className="options-header">
        <div className="header-content">
          <h1>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 10 }} aria-hidden="true">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
            ProofSnap Settings
          </h1>
          <p className="subtitle">Snap once. Prove forever.</p>
        </div>
      </header>

      <div className="options-content">
        <HuntModeSettings settings={settings} onSave={handleSaveSettings} />
        <WatermarkSettings settings={settings} onSave={handleSaveSettings} />
        <WebsiteInfoSettings settings={settings} onSave={handleSaveSettings} />
        <LocationSettings settings={settings} onSave={handleSaveSettings} />
        <CaptureSettings settings={settings} onSave={handleSaveSettings} />
        <UploadSettings settings={settings} onSave={handleSaveSettings} />

        {/* Save indicator */}
        <div className="saved-message">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }} aria-hidden="true">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          Settings saved
        </div>
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(<OptionsApp />);
}
