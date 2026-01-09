/**
 * Shared type definitions for ProofSnap browser extension
 * All types are self-contained - no external dependencies
 */

/**
 * Browser extension specific types
 */

// Screenshot capture types
export type CaptureMode = 'visible' | 'selection' | 'fullpage';

export interface ScreenshotOptions {
  mode: CaptureMode;
  format: 'png' | 'jpeg';
  quality?: number; // 0-100 for JPEG
  includeTimestamp: boolean;
  includeLocation: boolean;
}

export interface ScreenshotResult {
  dataUrl: string;
  blob: Blob;
  width: number;
  height: number;
  timestamp: Date;
  location?: GeolocationPosition;
}

export interface SelectionCoordinates {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Storage types for chrome.storage
export interface StorageKeys {
  auth_token?: string;
  user_data?: string; // JSON string
  assets?: string; // JSON string of Asset[]
  settings?: string; // JSON string of UserSettings
  upload_queue?: string; // JSON string of Asset[]
}

export interface UserSettings {
  autoUpload: boolean;
  includeLocation: boolean;
  includeTimestamp: boolean;
  defaultCaptureMode: CaptureMode;
  screenshotFormat: 'png' | 'jpeg';
  screenshotQuality: number;
}

// Message passing types for extension communication
export type MessageType =
  | 'CAPTURE_SCREENSHOT'
  | 'SCREENSHOT_CAPTURED'
  | 'UPLOAD_ASSET'
  | 'UPLOAD_PROGRESS'
  | 'UPLOAD_COMPLETE'
  | 'UPLOAD_FAILED'
  | 'AUTH_STATUS_CHANGED'
  | 'SETTINGS_UPDATED'
  | 'ADD_WATERMARK'
  | 'START_GOOGLE_AUTH'
  | 'SELECTION_COMPLETE'
  | 'CROP_IMAGE';

export interface ExtensionMessage<T = any> {
  type: MessageType;
  payload?: T;
}

export interface CaptureScreenshotMessage {
  type: 'CAPTURE_SCREENSHOT';
  payload: {
    mode: CaptureMode;
    options?: Partial<ScreenshotOptions>;
  };
}

export interface ScreenshotCapturedMessage {
  type: 'SCREENSHOT_CAPTURED';
  payload: {
    dataUrl: string;
    timestamp: Date;
    location?: GeolocationPosition;
  };
}

export interface UploadProgressMessage {
  type: 'UPLOAD_PROGRESS';
  payload: {
    assetId: string;
    progress: number; // 0-100
  };
}
