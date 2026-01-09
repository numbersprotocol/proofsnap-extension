/**
 * Offscreen Document for Canvas Operations
 * Used for adding watermarks to screenshots and cropping
 */

console.log('ProofSnap offscreen document loaded');

// Type definitions for watermark options
interface WatermarkPayload {
  dataUrl: string;
  timestamp: string;
  width: number;
  height: number;
  timestampSize?: 'small' | 'medium' | 'large';
  timestampFormat?: 'full' | 'compact' | 'time-only';
  timestampOpacity?: number;
  timestampPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  includeTimestamp?: boolean;
  // Crop coordinates (optional)
  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

// Listen for messages from service worker
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'ADD_WATERMARK') {
    addWatermark(message.payload)
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }
  if (message.type === 'CROP_IMAGE') {
    cropImage(message.payload)
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (message.type === 'GET_GEOLOCATION') {
    getGeolocation()
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

/**
 * Get current geolocation
 * Returns latitude, longitude, accuracy, and timestamp
 */
async function getGeolocation(): Promise<{ latitude: number; longitude: number; accuracy: number; timestamp: number } | null> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        });
      },
      (error) => {
        console.warn('Geolocation error:', error.message);
        // Don't reject - just return null so capture continues
        resolve(null);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000, // Cache for 1 minute
      }
    );
  });
}

/**
 * Crop image to specified coordinates
 */
async function cropImage(payload: {
  dataUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
}): Promise<{ dataUrl: string; width: number; height: number }> {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  const img = await loadImage(payload.dataUrl);
  
  // Set canvas to crop dimensions
  canvas.width = payload.width;
  canvas.height = payload.height;
  
  // Draw cropped portion
  ctx.drawImage(
    img,
    payload.x, payload.y, payload.width, payload.height,
    0, 0, payload.width, payload.height
  );

  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: payload.width,
    height: payload.height
  };
}

/**
 * Add watermark to screenshot
 * - Logo is always added in bottom-right
 * - Timestamp is optional based on user settings
 */
async function addWatermark(payload: WatermarkPayload): Promise<{ dataUrl: string }> {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  // Load original image
  const img = await loadImage(payload.dataUrl);
  
  // Handle cropping if specified
  if (payload.crop) {
    canvas.width = payload.crop.width;
    canvas.height = payload.crop.height;
    ctx.drawImage(
      img,
      payload.crop.x, payload.crop.y, payload.crop.width, payload.crop.height,
      0, 0, payload.crop.width, payload.crop.height
    );
  } else {
    canvas.width = payload.width;
    canvas.height = payload.height;
    ctx.drawImage(img, 0, 0);
  }

  // Add timestamp if enabled
  if (payload.includeTimestamp !== false) {
    drawTimestamp(ctx, payload.timestamp, {
      size: payload.timestampSize,
      format: payload.timestampFormat,
      opacity: payload.timestampOpacity,
      position: payload.timestampPosition,
    });
  }

  // Always draw logo
  await drawLogo(ctx, canvas.width, canvas.height);

  // Convert to data URL
  return { dataUrl: canvas.toDataURL('image/png') };
}

/**
 * Timestamp options interface
 */
interface TimestampOptions {
  size?: 'small' | 'medium' | 'large';
  format?: 'full' | 'compact' | 'time-only';
  opacity?: number;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

/**
 * Draw timestamp watermark with flexible positioning and styling
 */
function drawTimestamp(
  ctx: CanvasRenderingContext2D,
  timestampStr: string,
  options: TimestampOptions = {}
): void {
  const {
    size = 'medium',
    format = 'full',
    opacity = 1.0,
    position = 'top-left'
  } = options;

  const timestamp = new Date(timestampStr);
  
  // Format text based on format option
  let timeText: string;
  let dateText: string | null;
  
  switch (format) {
    case 'time-only':
      timeText = formatTime(timestamp);
      dateText = null;
      break;
    case 'compact':
      timeText = formatTime(timestamp);
      dateText = formatDateCompact(timestamp);
      break;
    case 'full':
    default:
      timeText = formatTime(timestamp);
      dateText = formatDate(timestamp);
      break;
  }

  // Calculate responsive sizing
  const sizeMultipliers = { small: 1.5, medium: 2, large: 2.5 };
  const sizeMultiplier = sizeMultipliers[size];
  const baseFontSize = Math.max(20, Math.floor(ctx.canvas.height / 35));
  const timeFontSize = baseFontSize * sizeMultiplier;
  const dateFontSize = baseFontSize * (sizeMultiplier / 2);

  // Measure text
  ctx.font = `700 ${timeFontSize}px system-ui, -apple-system, sans-serif`;
  const timeWidth = ctx.measureText(timeText).width;
  
  let dateWidth = 0;
  if (dateText) {
    ctx.font = `400 ${dateFontSize}px system-ui, -apple-system, sans-serif`;
    dateWidth = ctx.measureText(dateText).width;
  }

  // Calculate box dimensions
  const padding = 16;
  const boxWidth = Math.max(timeWidth, dateWidth) + padding * 2;
  const boxHeight = dateText 
    ? timeFontSize + dateFontSize + padding * 2 + 8
    : timeFontSize + padding * 2;
  
  // Calculate position based on setting
  const margin = 20;
  let posX: number;
  let posY: number;
  
  switch (position) {
    case 'top-right':
      posX = ctx.canvas.width - boxWidth - margin;
      posY = 60;
      break;
    case 'bottom-left':
      posX = margin;
      posY = ctx.canvas.height - boxHeight - margin;
      break;
    case 'bottom-right':
      posX = ctx.canvas.width - boxWidth - margin;
      posY = ctx.canvas.height - boxHeight - margin;
      break;
    case 'top-left':
    default:
      posX = margin;
      posY = 60;
      break;
  }

  // Apply opacity
  ctx.globalAlpha = opacity;

  // Draw background box with shadow
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.1)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.beginPath();
  ctx.roundRect(posX, posY, boxWidth, boxHeight, 8);
  ctx.fill();

  // Draw border
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Reset shadow
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // Draw text
  ctx.fillStyle = '#1a1a1a';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  ctx.font = `700 ${timeFontSize}px system-ui, -apple-system, sans-serif`;
  ctx.fillText(timeText, posX + padding, posY + padding);

  if (dateText) {
    ctx.fillStyle = 'rgba(26, 26, 26, 0.9)';
    ctx.font = `400 ${dateFontSize}px system-ui, -apple-system, sans-serif`;
    ctx.fillText(dateText, posX + padding, posY + padding + timeFontSize + 4);
  }

  // Reset opacity
  ctx.globalAlpha = 1.0;
}

/**
 * Draw ProofSnap logo in bottom-right corner
 */
async function drawLogo(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number
): Promise<void> {
  try {
    const logo = await loadImage('../../images/Word-Logo-Bright-crop.png');
    const logoWidth = Math.max(100, Math.floor(canvasWidth / 12));
    const logoHeight = logoWidth * (157 / 828); // Exact aspect ratio from source (828x157)
    const logoX = canvasWidth - logoWidth - 20;
    const logoY = canvasHeight - logoHeight - 20;

    ctx.globalAlpha = 0.7;
    ctx.drawImage(logo, logoX, logoY, logoWidth, logoHeight);
    ctx.globalAlpha = 1.0;
  } catch (error) {
    console.warn('Failed to load logo:', error);
  }
}

/**
 * Load image from data URL
 */
function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/**
 * Format time (HH:MM)
 */
function formatTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Format date (DD/MM/YYYY Day) - Full format
 */
function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short' });
  
  return `${day}/${month}/${year} ${weekday}`;
}

/**
 * Format date compact (DD/MM/YY) - Compact format
 */
function formatDateCompact(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2);
  
  return `${day}/${month}/${year}`;
}

export {};
