/**
 * Background Service Worker
 * Handles extension lifecycle, message passing, and background tasks
 */

import { storageService } from '../services/StorageService';
import { indexedDBService } from '../services/IndexedDBService';
import { getNumbersApi } from '../services/NumbersApiManager';
import { ExtensionMessage, CaptureScreenshotMessage, SelectionCoordinates } from '../types';
import { logger } from '../utils/logger';

logger.log('ProofSnap background service worker loaded');

// Use singleton service instances
const assetStorage = indexedDBService;
const metadataStorage = storageService;

// Initialize storage services
Promise.all([
  assetStorage.init(),
  metadataStorage.init()
]).then(async () => {
  logger.log('Storage services initialized (IndexedDB + chrome.storage ready)');

  // Initialize NumbersApiManager and register upload completion callback
  try {
    const numbersApi = await getNumbersApi();
    numbersApi.upload.onUploadComplete((assetId: string) => {
      logger.log('📥 Upload completion callback triggered for asset:', assetId);
      updateExtensionBadge();
    });
    logger.log('Upload completion callback registered');
  } catch (error) {
    logger.error('Failed to initialize NumbersApiManager:', error);
  }
}).catch(error => {
  logger.error('Failed to initialize services:', error);
});

/**
 * Handle extension installation
 */
chrome.runtime.onInstalled.addListener((details) => {
  logger.log('Extension installed:', details.reason);

  if (details.reason === 'install') {
    // Set default settings on first install
    metadataStorage.setSettings({
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
    });

    // Open welcome page
    chrome.tabs.create({
      url: chrome.runtime.getURL('options.html'),
    });
  }
});

/**
 * Handle keyboard shortcut commands
 */
chrome.commands.onCommand.addListener(async (command) => {
  logger.log('Command received:', command);

  if (command === 'capture-screenshot') {
    await handleScreenshotCapture('visible');
  }
});

/**
 * Handle extension icon click
 */
chrome.action.onClicked.addListener(async (tab) => {
  logger.log('Extension icon clicked', tab);
  // The popup will open automatically, no need to handle here
});

/**
 * Handle messages from popup
 */
chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  // Reject messages from other extensions or web pages
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ success: false, error: 'Unauthorized sender' });
    return false;
  }

  logger.log('Message received:', message.type);

  switch (message.type) {
    case 'CAPTURE_SCREENSHOT':
      handleScreenshotCaptureMessage(message as CaptureScreenshotMessage)
        .then((result) => {
          if (result && result.cancelled) {
            sendResponse({ success: false, cancelled: true });
          } else {
            sendResponse({ success: true, data: result });
          }
        })
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true; // Keep channel open for async response

    case 'UPLOAD_ASSET':
      // Only allow from extension pages, not content scripts
      if (sender.tab) {
        sendResponse({ success: false, error: 'Unauthorized sender' });
        return false;
      }
      handleAssetUpload(message.payload)
        .then(() => sendResponse({ success: true }))
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;

    case 'START_GOOGLE_AUTH':
      // Only allow from extension pages, not content scripts
      if (sender.tab) {
        sendResponse({ success: false, error: 'Unauthorized sender' });
        return false;
      }
      logger.log('Starting Google Auth in background...');
      (async () => {
        try {
          const numbersApi = await getNumbersApi();

          // 1. Get ID Token via Chrome Identity (interactive flow)
          logger.log('Background: Requesting Google ID Token...');
          const token = await numbersApi.auth.authenticateWithGoogle();
          logger.log('Background: Got ID Token. Logging in to backend...');

          // 2. Exchange ID Token for numbers protocol auth token
          await numbersApi.loginGoogle(token);
          logger.log('Background: Google Login successful.');

          sendResponse({ success: true });
        } catch (error: any) {
          logger.error('Background: Google Auth failed:', error);
          const errorMessage = error.message || 'Google Auth failed';
          await storageService.setGoogleAuthError(errorMessage);
          sendResponse({ success: false, error: errorMessage });
        }
      })();
      return true; // Keep channel open for async response

    case 'SELECTION_COMPLETE':
      // Handle selection complete from content script
      handleSelectionComplete(message.payload)
        .then(() => sendResponse({ success: true }))
        .catch((error) => {
          logger.error('Selection completion failed:', error);
          rejectPendingSelection(error);
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return true;

    default:
      logger.warn('Unknown message type:', message.type);
      sendResponse({ success: false, error: 'Unknown message type' });
  }
});

/**
 * Handle screenshot capture from message
 */
async function handleScreenshotCaptureMessage(message: CaptureScreenshotMessage) {
  const { mode, options = {}, fromPopup } = message.payload;
  return await handleScreenshotCapture(mode, { ...options, fromPopup });
}

// Store pending selection resolve/reject callbacks
let pendingSelectionResolve: ((value: any) => void) | null = null;
let pendingSelectionReject: ((reason: any) => void) | null = null;
let pendingSelectionFromPopup = false;

function rejectPendingSelection(error: unknown): void {
  if (pendingSelectionReject) {
    pendingSelectionReject(error);
    pendingSelectionResolve = null;
    pendingSelectionReject = null;
    pendingSelectionFromPopup = false;
  }
}

/**
 * Handle selection mode capture
 * Injects content script and waits for user selection
 */
async function handleSelectionCapture(tab: chrome.tabs.Tab): Promise<any> {
  if (!tab.id) {
    throw new Error('No active tab found');
  }

  // Inject the selection overlay content script
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/selection-overlay.js'],
    });
  } catch (error) {
    logger.error('Failed to inject selection script:', error);
    throw new Error('Failed to start selection mode. Make sure you are on a valid web page.');
  }

  // Wait for selection to complete via message
  return new Promise((resolve, reject) => {
    pendingSelectionResolve = resolve;
    pendingSelectionReject = reject;

    // Timeout after 60 seconds
    setTimeout(() => {
      if (pendingSelectionReject) {
        pendingSelectionReject(new Error('Selection timed out'));
        pendingSelectionResolve = null;
        pendingSelectionReject = null;
      }
    }, 60000);
  });
}

/**
 * Validate SelectionCoordinates payload
 */
function validateCoordinates(coords: unknown): coords is SelectionCoordinates {
  if (!coords || typeof coords !== 'object') return false;
  const c = coords as Record<string, unknown>;
  return (
    typeof c.x === 'number' &&
    typeof c.y === 'number' &&
    typeof c.width === 'number' &&
    typeof c.height === 'number' &&
    c.width > 0 &&
    c.height > 0 &&
    c.width <= 32767 &&
    c.height <= 32767
  );
}

/**
 * Validate asset upload payload
 */
function validateAssetUploadPayload(payload: unknown): payload is { assetId: string } {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  return typeof p.assetId === 'string' && p.assetId.length > 0;
}

/**
 * Handle selection complete message from content script
 */
async function handleSelectionComplete(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid selection payload');
  }
  const p = payload as Record<string, unknown>;
  if (p.cancelled) {
    const reason = typeof p.reason === 'string' ? p.reason : undefined;
    logger.log('Selection cancelled:', reason);
    if (pendingSelectionResolve) {
      pendingSelectionResolve({ cancelled: true, reason });
      pendingSelectionResolve = null;
      pendingSelectionReject = null;
    }
    return;
  }

  const { coordinates } = p;
  if (!validateCoordinates(coordinates)) {
    throw new Error('Invalid or out-of-range selection coordinates');
  }
  logger.log('Selection complete:', coordinates);

  try {
    // Get the active tab to capture
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id || !tab.windowId) {
      throw new Error('No active tab found');
    }

    // Capture timestamp at capture time
    const captureTime = new Date();

    // Get user settings
    const settings = await metadataStorage.getSettings();

    // Capture full visible tab
    let dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: settings.screenshotFormat === 'jpeg' ? 'jpeg' : 'png',
      quality: settings.screenshotFormat === 'jpeg' ? settings.screenshotQuality : undefined,
    });

    // Crop and add watermark via offscreen document
    await ensureOffscreenDocument();

    const response = await chrome.runtime.sendMessage({
      type: 'ADD_WATERMARK',
      payload: {
        dataUrl,
        timestamp: captureTime.toISOString(),
        width: coordinates.width,
        height: coordinates.height,
        timestampSize: settings.timestampSize,
        timestampFormat: settings.timestampFormat,
        timestampOpacity: settings.timestampOpacity,
        timestampPosition: settings.timestampPosition,
        includeTimestamp: settings.includeTimestamp,
        crop: coordinates,
      },
    });

    if (response.success) {
      dataUrl = response.data.dataUrl;
      logger.log('✅ Selection cropped and watermark added');
    } else {
      logger.warn('Failed to process selection:', response.error);
    }

    // Get location if enabled via offscreen document
    let gpsLocation: { latitude: number; longitude: number; accuracy: number; timestamp: number } | undefined = undefined;
    if (settings.includeLocation) {
      try {
        await ensureOffscreenDocument();
        const locationResponse = await chrome.runtime.sendMessage({
          type: 'GET_GEOLOCATION',
        });
        if (locationResponse.success && locationResponse.data) {
          gpsLocation = locationResponse.data;
          logger.log('✅ Geolocation captured');
        } else {
          logger.warn('⚠️ Could not get geolocation:', locationResponse.error || 'Permission denied or unavailable');
        }
      } catch (error) {
        logger.warn('⚠️ Geolocation error:', error);
        // Continue without location
      }
    }

    // Capture website metadata if enabled
    let sourceWebsite = undefined;
    if (settings.includeWebsiteInfo && tab.url && tab.title) {
      try {
        sourceWebsite = {
          url: tab.url,
          title: tab.title,
        };
      } catch (error) {
        logger.warn('Failed to parse URL:', error);
      }
    }

    // Store screenshot as asset
    const assetId = `screenshot_${captureTime.getTime()}_${Math.random().toString(36).slice(2, 11)}`;

    const asset = {
      id: assetId,
      uri: dataUrl,
      type: 'image' as const,
      mimeType: `image/${settings.screenshotFormat}`,
      createdAt: captureTime.getTime(),
      status: 'draft' as const,
      metadata: {
        uploadedAt: captureTime.toISOString(),
        width: coordinates.width,
        height: coordinates.height,
        captureMode: 'selection',
      },
      gpsLocation,
      sourceWebsite,
    };

    await assetStorage.setAsset(asset);

    // Show notification
    await showCaptureNotification(settings.autoUpload && !pendingSelectionFromPopup);
    await updateExtensionBadge();

    // Auto-upload if enabled and not initiated from popup
    // (popup handles upload after showing headline/caption modal)
    if (settings.autoUpload && !pendingSelectionFromPopup) {
      try {
        let numbersApi = await getNumbersApi();
        let auth = numbersApi.auth.isAuthenticated();
        
        // If not authenticated in memory, try to reload token from storage
        if (!auth) {
          const storedAuth = await metadataStorage.getAuth();
          if (storedAuth?.token) {
            numbersApi.setAuthToken(storedAuth.token);
            auth = true;
            logger.log('✅ Restored auth token from storage');
          }
        }
        
        if (auth) {
          await numbersApi.upload.addToQueue(asset);
          logger.log('✅ Asset added to upload queue');
        }
      } catch (uploadError) {
        logger.error('Failed to add asset to upload queue:', uploadError);
      }
    }

    // Notify popup
    chrome.runtime.sendMessage({
      type: 'SCREENSHOT_CAPTURED',
      payload: {
        assetId,
        dataUrl,
        timestamp: captureTime,
      },
    });

    // Resolve the pending promise
    if (pendingSelectionResolve) {
      pendingSelectionResolve({
        assetId,
        dataUrl,
        timestamp: captureTime.toISOString(),
        autoUpload: settings.autoUpload && !pendingSelectionFromPopup,
      });
      pendingSelectionResolve = null;
      pendingSelectionReject = null;
      pendingSelectionFromPopup = false;
    }
  } catch (error: any) {
    logger.error('Failed to capture selection:', error);
    rejectPendingSelection(error);
    throw error;
  }
}

/**
 * Ensure offscreen document exists for canvas operations
 */
async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as any],
  });

  if (existingContexts.length > 0) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: 'src/offscreen/offscreen.html',
    reasons: ['BLOBS' as any],
    justification: 'Add timestamp watermark to screenshots',
  });
}

/**
 * Handle screenshot capture
 */
async function handleScreenshotCapture(
  mode: 'visible' | 'selection' | 'fullpage',
  options: any = {}
) {
  const fromPopup = options?.fromPopup === true;
  try {
    // Get current active tab first
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id || !tab.windowId) {
      throw new Error('No active tab found');
    }

    // Handle selection mode - inject content script and wait for selection
    if (mode === 'selection') {
      pendingSelectionFromPopup = fromPopup;
      return await handleSelectionCapture(tab);
    }

    // Capture timestamp at the very start for consistency
    const captureTime = new Date();

    // Get user settings
    const settings = await metadataStorage.getSettings();

    // Capture screenshot directly using Chrome API
    let dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: settings.screenshotFormat === 'jpeg' ? 'jpeg' : 'png',
      quality: settings.screenshotFormat === 'jpeg' ? settings.screenshotQuality : undefined,
    });

    // Get image dimensions from data URL
    const img = await createImageBitmap(await (await fetch(dataUrl)).blob());
    let width = img.width;
    let height = img.height;

    // Add watermark (logo always included, timestamp optional)
    try {
      await ensureOffscreenDocument();

      const response = await chrome.runtime.sendMessage({
        type: 'ADD_WATERMARK',
        payload: {
          dataUrl,
          timestamp: captureTime.toISOString(),
          width,
          height,
          timestampSize: settings.timestampSize,
          timestampFormat: settings.timestampFormat,
          timestampOpacity: settings.timestampOpacity,
          timestampPosition: settings.timestampPosition,
          includeTimestamp: settings.includeTimestamp,
        },
      });

      if (response.success) {
        dataUrl = response.data.dataUrl;
        logger.log('✅ Watermark added successfully');
      } else {
        logger.warn('Failed to add watermark:', response.error);
      }
    } catch (error) {
      logger.error('Watermark error:', error);
      // Continue without watermark if it fails
    }

    // Get location if enabled via offscreen document
    let gpsLocation: { latitude: number; longitude: number; accuracy: number; timestamp: number } | undefined = undefined;
    if (settings.includeLocation) {
      try {
        await ensureOffscreenDocument();
        const locationResponse = await chrome.runtime.sendMessage({
          type: 'GET_GEOLOCATION',
        });
        if (locationResponse.success && locationResponse.data) {
          gpsLocation = locationResponse.data;
          logger.log('✅ Geolocation captured');
        } else {
          logger.warn('⚠️ Could not get geolocation:', locationResponse.error || 'Permission denied or unavailable');
        }
      } catch (error) {
        logger.warn('⚠️ Geolocation error:', error);
        // Continue without location
      }
    }

    // Capture website metadata if enabled
    let sourceWebsite = undefined;
    if (settings.includeWebsiteInfo && tab.url && tab.title) {
      try {
        const url = new URL(tab.url);
        sourceWebsite = {
          url: tab.url,
          title: tab.title,
        };
        logger.log('✅ Website metadata captured:', url.hostname);
      } catch (error) {
        logger.warn('Failed to parse URL:', error);
      }
    }

    // Store screenshot as asset
    const assetId = `screenshot_${captureTime.getTime()}_${Math.random().toString(36).slice(2, 11)}`;

    const asset = {
      id: assetId,
      uri: dataUrl,
      type: 'image' as const,
      mimeType: `image/${settings.screenshotFormat}`,
      createdAt: captureTime.getTime(),
      status: 'draft' as const,
      metadata: {
        uploadedAt: captureTime.toISOString(),
        width,
        height,
      },
      gpsLocation,
      sourceWebsite,
    };

    await assetStorage.setAsset(asset);

    // Note: mode and options parameters preserved for future implementation
    logger.log('Capture mode:', mode, 'Options:', options);

    // Notify popup of new screenshot
    chrome.runtime.sendMessage({
      type: 'SCREENSHOT_CAPTURED',
      payload: {
        assetId,
        dataUrl,
        timestamp: captureTime,
      },
    });

    // Show user feedback for quick capture
    await showCaptureNotification(settings.autoUpload && !fromPopup);
    await updateExtensionBadge();

    // Auto-upload if enabled and not initiated from popup
    // (popup handles upload after showing headline/caption modal)
    if (settings.autoUpload && !fromPopup) {
      try {
        let numbersApi = await getNumbersApi();
        let auth = numbersApi.auth.isAuthenticated();
        
        // If not authenticated in memory, try to reload token from storage
        if (!auth) {
          const storedAuth = await metadataStorage.getAuth();
          if (storedAuth?.token) {
            numbersApi.setAuthToken(storedAuth.token);
            auth = true;
            logger.log('✅ Restored auth token from storage');
          }
        }
        
        if (auth) {
          await numbersApi.upload.addToQueue(asset);
          logger.log('✅ Asset added to upload queue');
        } else {
          logger.log('⚠️ Auto-upload enabled but user not authenticated');
        }
      } catch (uploadError) {
        logger.error('Failed to add asset to upload queue:', uploadError);
        // Don't fail the capture if upload queueing fails
      }
    }

    return {
      assetId,
      dataUrl,
      timestamp: captureTime.toISOString(),
      autoUpload: settings.autoUpload && !fromPopup,
    };
  } catch (error) {
    logger.error('Screenshot capture failed:', error);
    throw error;
  }
}

/**
 * Show browser notification for successful capture
 */
async function showCaptureNotification(autoUpload: boolean) {
  logger.log('🔔 Attempting to show notification, autoUpload:', autoUpload);

  try {
    logger.log('✅ Creating Chrome notification...');
    const notificationOptions = {
      type: 'basic' as const,
      iconUrl: chrome.runtime.getURL('icons/icon48.png'),
      title: 'ProofSnap',
      message: autoUpload
        ? 'Screenshot captured and queued for upload'
        : 'Screenshot captured successfully',
      requireInteraction: false, // Allow auto-dismiss
    };

    const notificationId = `proofsnap-${Date.now()}`;
    chrome.notifications.create(notificationId, notificationOptions, (createdId) => {
      if (chrome.runtime.lastError) {
        logger.error('❌ Notification creation error:', chrome.runtime.lastError);
      } else {
        logger.log('✅ Notification created:', createdId);
        // Auto-clear after 3 seconds
        setTimeout(() => {
          chrome.notifications.clear(notificationId);
          logger.log('🔔 Notification cleared');
        }, 3000);
      }
    });

    logger.log('✅ Notification shown');
  } catch (error) {
    logger.error('❌ Failed to show notification:', error);
  }
}

/**
 * Update extension icon badge with pending asset count
 */
async function updateExtensionBadge() {
  try {
    const assets = await assetStorage.getAllAssets();
    const pendingCount = assets.length;

    if (pendingCount > 0) {
      chrome.action.setBadgeText({ text: pendingCount.toString() });
      chrome.action.setBadgeBackgroundColor({ color: '#FF5560' }); // Red for pending
    } else {
      chrome.action.setBadgeText({ text: '' }); // Clear badge
    }
  } catch (error) {
    logger.warn('Failed to update badge:', error);
  }
}

/**
 * Handle asset upload
 */
async function handleAssetUpload(payload: unknown) {
  if (!validateAssetUploadPayload(payload)) {
    throw new Error('Invalid asset upload payload');
  }
  try {
    const asset = await assetStorage.getAsset(payload.assetId);

    if (!asset) {
      throw new Error('Asset not found');
    }

    const numbersApi = await getNumbersApi();
    // Pass isManualRetry=true since this is triggered by user clicking retry
    await numbersApi.upload.addToQueue(asset, true);
    logger.log('Asset queued for manual retry upload:', asset.id);
  } catch (error) {
    logger.error('Failed to queue asset for upload:', error);
    throw error;
  }
}

/**
 * Keep service worker alive
 */
self.addEventListener('activate', (_event) => {
  logger.log('Service worker activated');
});

// Export for testing (if needed)
export { handleScreenshotCapture };
