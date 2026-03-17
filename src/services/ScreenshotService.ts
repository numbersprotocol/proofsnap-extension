/**
 * Screenshot Service for Browser Extension
 * Handles screenshot capture with timestamp watermarking
 */

import { ScreenshotOptions, ScreenshotResult, SelectionCoordinates } from '@/types';
import { createLogger } from '@/utils/logger';

const logger = createLogger('ScreenshotService');

/**
 * Screenshot Service
 * Captures screenshots using Chrome extension APIs
 */
export class ScreenshotService {
  /**
   * Capture visible portion of current tab
   */
  async captureVisibleTab(options: Partial<ScreenshotOptions> = {}): Promise<ScreenshotResult> {
    const { format = 'png', quality = 90 } = options;

    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id) {
      throw new Error('No active tab found');
    }

    // Capture visible tab
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: format === 'jpeg' ? 'jpeg' : 'png',
      quality: format === 'jpeg' ? quality : undefined,
    });

    // Convert data URL to blob
    const blob = await this.dataUrlToBlob(dataUrl);

    // Get image dimensions
    const { width, height } = await this.getImageDimensions(dataUrl);

    const result: ScreenshotResult = {
      dataUrl,
      blob,
      width,
      height,
      timestamp: new Date(),
    };

    // Add timestamp watermark if requested
    if (options.includeTimestamp) {
      const watermarked = await this.addTimestampWatermark(result);
      return watermarked;
    }

    return result;
  }

  /**
   * Capture selected area of the page
   * Future feature: Will require UI for area selection
   */
  async captureSelection(
    coordinates: SelectionCoordinates,
    options: Partial<ScreenshotOptions> = {}
  ): Promise<ScreenshotResult> {
    // First capture the full visible tab
    const fullCapture = await this.captureVisibleTab({ ...options, includeTimestamp: false });

    // Crop to selection
    const cropped = await this.cropImage(fullCapture, coordinates);

    // Add timestamp watermark if requested
    if (options.includeTimestamp) {
      return await this.addTimestampWatermark(cropped);
    }

    return cropped;
  }

  /**
   * Capture full page (requires scrolling and stitching)
   * This is more complex and will be implemented in a future phase
   */
  async captureFullPage(options: Partial<ScreenshotOptions> = {}): Promise<ScreenshotResult> {
    // For now, just capture visible tab
    // TODO: Implement full page capture with scrolling
    logger.warn('Full page capture not yet implemented, capturing visible area');
    return await this.captureVisibleTab(options);
  }

  /**
   * Add timestamp watermark to screenshot
   */
  async addTimestampWatermark(screenshot: ScreenshotResult): Promise<ScreenshotResult> {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get canvas context');
    }

    // Load image
    const img = await this.loadImage(screenshot.dataUrl);
    canvas.width = img.width;
    canvas.height = img.height;

    // Draw original image
    ctx.drawImage(img, 0, 0);

    // Prepare timestamp text
    const timestamp = screenshot.timestamp || new Date();
    const timestampText = this.formatTimestamp(timestamp);

    // Configure text style
    const fontSize = Math.max(16, Math.floor(canvas.height / 40));
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';

    // Measure text for background
    const metrics = ctx.measureText(timestampText);
    const textWidth = metrics.width;
    const textHeight = fontSize * 1.5;
    const padding = fontSize * 0.5;

    // Position at bottom-left
    const x = padding;
    const y = canvas.height - padding;

    // Draw semi-transparent background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(
      x - padding / 2,
      y - textHeight,
      textWidth + padding,
      textHeight + padding / 2
    );

    // Draw white text with black stroke for better readability
    ctx.strokeStyle = 'black';
    ctx.lineWidth = fontSize / 8;
    ctx.strokeText(timestampText, x, y);
    
    ctx.fillStyle = 'white';
    ctx.fillText(timestampText, x, y);

    // Convert canvas to blob and data URL
    const watermarkedBlob = await this.canvasToBlob(canvas);
    const watermarkedDataUrl = canvas.toDataURL('image/png');

    return {
      ...screenshot,
      dataUrl: watermarkedDataUrl,
      blob: watermarkedBlob,
    };
  }

  /**
   * Crop image to specified coordinates
   */
  private async cropImage(
    screenshot: ScreenshotResult,
    coords: SelectionCoordinates
  ): Promise<ScreenshotResult> {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get canvas context');
    }

    // Load original image
    const img = await this.loadImage(screenshot.dataUrl);

    // Set canvas to crop size
    canvas.width = coords.width;
    canvas.height = coords.height;

    // Draw cropped portion
    ctx.drawImage(
      img,
      coords.x, coords.y, coords.width, coords.height,
      0, 0, coords.width, coords.height
    );

    // Convert to blob and data URL
    const blob = await this.canvasToBlob(canvas);
    const dataUrl = canvas.toDataURL('image/png');

    return {
      dataUrl,
      blob,
      width: coords.width,
      height: coords.height,
      timestamp: screenshot.timestamp,
      location: screenshot.location,
    };
  }

  /**
   * Format timestamp for display
   */
  private formatTimestamp(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  /**
   * Convert data URL to Blob
   */
  private async dataUrlToBlob(dataUrl: string): Promise<Blob> {
    const response = await fetch(dataUrl);
    return await response.blob();
  }

  /**
   * Convert canvas to Blob
   */
  private async canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to convert canvas to blob'));
        }
      }, 'image/png');
    });
  }

  /**
   * Load image from data URL
   */
  private async loadImage(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  /**
   * Get image dimensions from data URL
   */
  private async getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
    const img = await this.loadImage(dataUrl);
    return { width: img.width, height: img.height };
  }

  /**
   * Get location data if permission granted
   */
  async getLocation(): Promise<GeolocationPosition | null> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => resolve(position),
        (error) => {
          logger.warn('Geolocation error', { error });
          resolve(null);
        },
        {
          enableHighAccuracy: true,
          timeout: 5000,
          maximumAge: 0,
        }
      );
    });
  }
}

// Export singleton instance
export const screenshotService = new ScreenshotService();
