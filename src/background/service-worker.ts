/**
 * Background Service Worker
 * Handles extension lifecycle, message passing, and background tasks
 */

import { storageService } from '../services/StorageService';
import { indexedDBService } from '../services/IndexedDBService';
import { getNumbersApi } from '../services/NumbersApiManager';
import { ExtensionMessage, CaptureScreenshotMessage } from '../types';

console.log('ProofSnap background service worker loaded');

// Use singleton service instances
const assetStorage = indexedDBService;
const metadataStorage = storageService;

// Initialize storage services
Promise.all([
  assetStorage.init(),
  metadataStorage.init()
]).then(async () => {
  console.log('Storage services initialized (IndexedDB + chrome.storage ready)');

  // Initialize NumbersApiManager and register upload completion callback
  try {
    const numbersApi = await getNumbersApi();
    numbersApi.upload.onUploadComplete((assetId: string) => {
      console.log('📥 Upload completion callback triggered for asset:', assetId);
      updateExtensionBadge();
    });
    console.log('Upload completion callback registered');
  } catch (error) {
    console.error('Failed to initialize NumbersApiManager:', error);
  }
}).catch(error => {
  console.error('Failed to initialize services:', error);
});

/**
 * Handle extension installation
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Extension installed:', details.reason);
  
  if (details.reason === 'install') {
    // Set default settings on first install
    metadataStorage.setSettings({
      autoUpload: true,
      includeLocation: false,
      includeTimestamp: true,
      includeWebsiteInfo: true,
      timestampSize: 'medium',
      defaultCaptureMode: 'visible',
      screenshotFormat: 'png',
      screenshotQuality: 90,
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
  console.log('Command received:', command);
  
  if (command === 'capture-screenshot') {
    await handleScreenshotCapture('visible');
  }
});

/**
 * Handle extension icon click
 */
chrome.action.onClicked.addListener(async (tab) => {
  console.log('Extension icon clicked', tab);
  // The popup will open automatically, no need to handle here
});

/**
 * Handle messages from popup
 */
chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  console.log('Message received:', message.type, message.payload);

  switch (message.type) {
    case 'CAPTURE_SCREENSHOT':
      handleScreenshotCaptureMessage(message as CaptureScreenshotMessage)
        .then((result) => sendResponse({ success: true, data: result }))
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true; // Keep channel open for async response

    case 'UPLOAD_ASSET':
      handleAssetUpload(message.payload)
        .then(() => sendResponse({ success: true }))
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;

    default:
      console.warn('Unknown message type:', message.type);
      sendResponse({ success: false, error: 'Unknown message type' });
  }
});

/**
 * Handle screenshot capture from message
 */
async function handleScreenshotCaptureMessage(message: CaptureScreenshotMessage) {
  const { mode, options = {} } = message.payload;
  return await handleScreenshotCapture(mode, options);
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
  try {
    // Capture timestamp at the very start for consistency
    const captureTime = new Date();

    // Get user settings
    const settings = await metadataStorage.getSettings();

    // Get current active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id || !tab.windowId) {
      throw new Error('No active tab found');
    }

    // Capture screenshot directly using Chrome API
    let dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: settings.screenshotFormat === 'jpeg' ? 'jpeg' : 'png',
      quality: settings.screenshotFormat === 'jpeg' ? settings.screenshotQuality : undefined,
    });

    // Get image dimensions from data URL
    const img = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const width = img.width;
    const height = img.height;

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
          includeTimestamp: settings.includeTimestamp,
        },
      });

      if (response.success) {
        dataUrl = response.data.dataUrl;
        console.log('✅ Watermark added successfully');
      } else {
        console.warn('Failed to add watermark:', response.error);
      }
    } catch (error) {
      console.error('Watermark error:', error);
      // Continue without watermark if it fails
    }

    // Get location if enabled (not available in service worker yet)
    if (settings.includeLocation) {
      console.log('Location not available in service worker context');
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
        console.log('✅ Website metadata captured:', url.hostname);
      } catch (error) {
        console.warn('Failed to parse URL:', error);
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
      gpsLocation: undefined,
      sourceWebsite,
    };

    await assetStorage.setAsset(asset);

    // Note: mode and options parameters preserved for future implementation
    console.log('Capture mode:', mode, 'Options:', options);

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
    await showCaptureNotification(settings.autoUpload);
    await updateExtensionBadge();

    // Auto-upload if enabled
    if (settings.autoUpload) {
      try {
        const numbersApi = await getNumbersApi();
        const auth = numbersApi.auth.isAuthenticated();
        if (auth) {
          await numbersApi.upload.addToQueue(asset);
          console.log('✅ Asset added to upload queue');
        } else {
          console.log('⚠️ Auto-upload enabled but user not authenticated');
        }
      } catch (uploadError) {
        console.error('Failed to add asset to upload queue:', uploadError);
        // Don't fail the capture if upload queueing fails
      }
    }

    return {
      assetId,
      dataUrl,
      timestamp: captureTime.toISOString(),
      autoUpload: settings.autoUpload,
    };
  } catch (error) {
    console.error('Screenshot capture failed:', error);
    throw error;
  }
}

/**
 * Show browser notification for successful capture
 */
async function showCaptureNotification(autoUpload: boolean) {
  console.log('🔔 Attempting to show notification, autoUpload:', autoUpload);

  try {
    console.log('✅ Creating Chrome notification...');
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
        console.error('❌ Notification creation error:', chrome.runtime.lastError);
      } else {
        console.log('✅ Notification created:', createdId);
        // Auto-clear after 3 seconds
        setTimeout(() => {
          chrome.notifications.clear(notificationId);
          console.log('🔔 Notification cleared');
        }, 3000);
      }
    });

    console.log('✅ Notification shown');
  } catch (error) {
    console.error('❌ Failed to show notification:', error);
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
    console.warn('Failed to update badge:', error);
  }
}

/**
 * Handle asset upload
 */
async function handleAssetUpload(payload: any) {
  try {
    const asset = await assetStorage.getAsset(payload.assetId);

    if (!asset) {
      throw new Error('Asset not found');
    }

    const numbersApi = await getNumbersApi();
    // Pass isManualRetry=true since this is triggered by user clicking retry
    await numbersApi.upload.addToQueue(asset, true);
    console.log('Asset queued for manual retry upload:', asset.id);
  } catch (error) {
    console.error('Failed to queue asset for upload:', error);
    throw error;
  }
}

/**
 * Keep service worker alive
 */
self.addEventListener('activate', (_event) => {
  console.log('Service worker activated');
});

// Export for testing (if needed)
export { handleScreenshotCapture };
