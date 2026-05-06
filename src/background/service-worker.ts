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
    if (numbersApi.auth.isAuthenticated()) {
      // Auth is initialized — safe to process restored queued uploads.
      await numbersApi.upload.startProcessing();
    }
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

    case 'REFRESH_BADGE':
      // Only allow from extension pages, not content scripts
      if (sender.tab) {
        sendResponse({ success: false, error: 'Unauthorized sender' });
        return false;
      }
      updateExtensionBadge()
        .then(() => sendResponse({ success: true }))
        .catch((error) => sendResponse({ success: false, error: error.message }));
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
  const { mode, options = {}, fromPopup, target } = message.payload;
  return await handleScreenshotCapture(mode, { ...options, fromPopup, target });
}

// Store pending selection resolve/reject callbacks
type PendingSelectionTarget = {
  tabId: number;
  windowId: number;
  url?: string;
};

let pendingSelectionResolve: ((value: any) => void) | null = null;
let pendingSelectionReject: ((reason: any) => void) | null = null;
let pendingSelectionFromPopup = false;
let pendingSelectionTimeoutId: ReturnType<typeof setTimeout> | null = null;
let pendingSelectionTarget: PendingSelectionTarget | null = null;

function clearPendingSelectionTimeout(): void {
  if (pendingSelectionTimeoutId !== null) {
    clearTimeout(pendingSelectionTimeoutId);
    pendingSelectionTimeoutId = null;
  }
}

function resetPendingSelectionState(): void {
  pendingSelectionResolve = null;
  pendingSelectionReject = null;
  pendingSelectionFromPopup = false;
  pendingSelectionTarget = null;
}

function rejectPendingSelection(error: unknown): void {
  const reject = pendingSelectionReject;
  clearPendingSelectionTimeout();
  if (reject) {
    reject(error);
  }
  resetPendingSelectionState();
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string') return maybeMessage;
  }
  return String(error);
}

function startProofSnapSelectionOverlay(): void {
  if ((window as any).__proofSnapSelectionActive) {
    return;
  }

  (window as any).__proofSnapSelectionActive = true;

  type SelectionCoordinates = {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  let overlay: HTMLDivElement | null = null;
  let selectionBox: HTMLDivElement | null = null;
  let isSelecting = false;
  let startX = 0;
  let startY = 0;

  function cleanup(): void {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    document.removeEventListener('keydown', handleKeyDown);

    ['proofsnap-selection-overlay', 'proofsnap-selection-box', 'proofsnap-instructions'].forEach((id) => {
      document.getElementById(id)?.remove();
    });

    overlay = null;
    selectionBox = null;
    (window as any).__proofSnapSelectionActive = false;
  }

  function sendResponse(data: any): void {
    chrome.runtime.sendMessage({
      type: 'SELECTION_COMPLETE',
      payload: data,
    });
  }

  function handleMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;

    isSelecting = true;
    startX = e.clientX;
    startY = e.clientY;

    if (selectionBox) {
      selectionBox.style.display = 'block';
      selectionBox.style.left = `${startX}px`;
      selectionBox.style.top = `${startY}px`;
      selectionBox.style.width = '0px';
      selectionBox.style.height = '0px';
    }

    if (overlay) {
      overlay.style.background = 'transparent';
    }
  }

  function handleMouseMove(e: MouseEvent): void {
    if (!isSelecting || !selectionBox) return;

    const currentX = e.clientX;
    const currentY = e.clientY;
    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);

    selectionBox.style.left = `${left}px`;
    selectionBox.style.top = `${top}px`;
    selectionBox.style.width = `${width}px`;
    selectionBox.style.height = `${height}px`;
  }

  function handleMouseUp(e: MouseEvent): void {
    if (!isSelecting) return;

    isSelecting = false;

    const currentX = e.clientX;
    const currentY = e.clientY;
    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);

    if (width < 10 || height < 10) {
      cleanup();
      sendResponse({ cancelled: true, reason: 'Selection too small' });
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const coordinates: SelectionCoordinates = {
      x: Math.round(left * dpr),
      y: Math.round(top * dpr),
      width: Math.round(width * dpr),
      height: Math.round(height * dpr),
    };

    cleanup();
    sendResponse({
      cancelled: false,
      coordinates,
      viewportCoordinates: { x: left, y: top, width, height },
    });
  }

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      cleanup();
      sendResponse({ cancelled: true, reason: 'User cancelled' });
    }
  }

  function initSelectionOverlay(): void {
    overlay = document.createElement('div');
    overlay.id = 'proofsnap-selection-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.5);
      z-index: 2147483647;
      cursor: crosshair;
      user-select: none;
    `;

    selectionBox = document.createElement('div');
    selectionBox.id = 'proofsnap-selection-box';
    selectionBox.style.cssText = `
      position: fixed;
      border: 2px dashed #fff;
      background: transparent;
      box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5);
      z-index: 2147483647;
      display: none;
      pointer-events: none;
    `;

    const instructions = document.createElement('div');
    instructions.id = 'proofsnap-instructions';
    instructions.innerHTML = `
      <div style="
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 14px;
        z-index: 2147483647;
        pointer-events: none;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      ">
        <strong>ProofSnap</strong> - Click and drag to select area. Press <kbd style="
          background: rgba(255,255,255,0.2);
          padding: 2px 6px;
          border-radius: 4px;
          margin: 0 4px;
        ">Esc</kbd> to cancel.
      </div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(selectionBox);
    document.body.appendChild(instructions);

    overlay.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('keydown', handleKeyDown);
  }

  if (document.body) {
    initSelectionOverlay();
  } else {
    document.addEventListener('DOMContentLoaded', initSelectionOverlay, { once: true });
  }
}

/**
 * Handle selection mode capture
 * Injects content script and waits for user selection
 */
async function handleSelectionCapture(tab: chrome.tabs.Tab, fromPopup: boolean): Promise<any> {
  if (!tab.id || !tab.windowId) {
    throw new Error('No active tab found');
  }

  // Validate that the tab is on a page that supports content script injection
  if (!tab.url?.match(/^https?:\/\//)) {
    throw new Error('Selection mode is only supported on web pages with http:// or https:// URLs. Chrome extension pages, local files, and browser pages cannot be captured.');
  }

  // Reject any existing pending selection to avoid resource leaks
  if (pendingSelectionReject) {
    rejectPendingSelection(new Error('Selection cancelled: a new selection was started'));
  }

  pendingSelectionFromPopup = fromPopup;

  // Inject the selection overlay content script
  try {
    try {
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(tab.id, { active: true });
    } catch (focusError) {
      logger.warn('Could not focus selection target before injection:', getErrorMessage(focusError));
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: startProofSnapSelectionOverlay,
    });
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    logger.error('Failed to inject selection script:', errorMessage);
    throw new Error(`Failed to start selection mode: ${errorMessage}`);
  }

  const selectionTarget: PendingSelectionTarget = {
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url,
  };

  // Wait for selection to complete via message
  return new Promise((resolve, reject) => {
    pendingSelectionResolve = resolve;
    pendingSelectionReject = reject;
    pendingSelectionTarget = selectionTarget;

    // Timeout after 60 seconds
    pendingSelectionTimeoutId = setTimeout(() => {
      if (pendingSelectionReject) {
        rejectPendingSelection(new Error('Selection timed out'));
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
    clearPendingSelectionTimeout();
    const resolve = pendingSelectionResolve;
    if (resolve) {
      resolve({ cancelled: true, reason });
    }
    resetPendingSelectionState();
    return;
  }

  const { coordinates } = p;
  if (!validateCoordinates(coordinates)) {
    throw new Error('Invalid or out-of-range selection coordinates');
  }
  logger.log('Selection complete:', coordinates);

  try {
    // Capture the same tab/window where the selection overlay was injected.
    const tab = pendingSelectionTarget
      ? await chrome.tabs.get(pendingSelectionTarget.tabId)
      : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
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

    const shouldAutoUpload = settings.autoUpload && !pendingSelectionFromPopup;

    // Show notification
    await showCaptureNotification(shouldAutoUpload);
    await updateExtensionBadge();

    // Auto-upload if enabled and not initiated from popup
    // (popup handles upload after showing headline/caption modal)
    if (shouldAutoUpload) {
      try {
        const numbersApi = await getNumbersApi();
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
    if (pendingSelectionTimeoutId !== null) {
      clearTimeout(pendingSelectionTimeoutId);
      pendingSelectionTimeoutId = null;
    }
    const resolve = pendingSelectionResolve;
    if (resolve) {
      resolve({
        assetId,
        dataUrl,
        timestamp: captureTime.toISOString(),
        autoUpload: shouldAutoUpload,
      });
    }
    resetPendingSelectionState();
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
    // Prefer the tab captured by the popup click handler. In a service worker,
    // currentWindow can be ambiguous once focus has moved to the extension popup.
    const tab = options?.target?.tabId
      ? await chrome.tabs.get(options.target.tabId)
      : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];

    if (!tab.id || !tab.windowId) {
      throw new Error('No active tab found');
    }

    // Handle selection mode - inject content script and wait for selection
    if (mode === 'selection') {
      try {
        return await handleSelectionCapture(tab, fromPopup);
      } catch (error) {
        resetPendingSelectionState();
        throw error;
      }
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
        const numbersApi = await getNumbersApi();
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
