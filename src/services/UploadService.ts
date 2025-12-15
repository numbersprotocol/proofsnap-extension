/**
 * Upload Service for Browser Extension
 * Handles asset uploads to Numbers Protocol blockchain
 */

import { ApiClient } from './ApiClient';
import { storageService } from './StorageService';
import { indexedDBService } from './IndexedDBService';
import type { Asset } from './IndexedDBService';

export interface UploadProgress {
  assetId: string;
  progress: number; // 0-1
  status: 'uploading' | 'uploaded' | 'failed';
  error?: string;
}

/**
 * Browser-compatible Upload Service
 */
export class UploadService {
  private uploadQueue: Asset[] = [];
  private isUploading = false;
  private isPaused = false;
  private progressCallbacks: Map<string, (progress: UploadProgress) => void> = new Map();
  private completionCallbacks: Map<string, (assetId: string) => void> = new Map();

  constructor(
    private apiClient: ApiClient,
    private assetStorage = indexedDBService,
    private metadataStorage = storageService
  ) {
    this.restoreQueue();
  }

  /**
   * Restore upload queue from storage on initialization
   */
  private async restoreQueue() {
    try {
      const queueIds = await this.metadataStorage.getUploadQueueIds();
      if (queueIds.length > 0) {
        // Get full asset data from IndexedDB
        const assets: Asset[] = [];
        for (const id of queueIds) {
          const asset = await this.assetStorage.getAsset(id);
          if (asset) {
            assets.push(asset);
          }
        }
        this.uploadQueue = assets;
        console.log(`Restored ${assets.length} assets to upload queue`);
        // Auto-start processing if not paused
        this.processQueue();
      }
    } catch (error) {
      console.error('Failed to restore upload queue:', error);
    }
  }

  /**
   * Add an asset to the upload queue
   * @param asset - The asset to upload
   * @param isManualRetry - Whether this is a manual retry by the user (unpauses queue)
   */
  async addToQueue(asset: Asset, isManualRetry = false): Promise<void> {
    // Check if already in queue
    const exists = this.uploadQueue.find(a => a.id === asset.id);
    if (exists) {
      console.log('Asset already in upload queue:', asset.id);
      return;
    }

    this.uploadQueue.push(asset);
    await this.saveQueue();

    // Unpause queue if this is a manual retry
    this.maybeUnpauseForManualRetry(isManualRetry);

    this.processQueue();
  }

  /**
   * Add multiple assets to queue
   * @param assets - The assets to upload
   * @param isManualRetry - Whether this is a manual retry by the user (unpauses queue)
   */
  async addMultipleToQueue(assets: Asset[], isManualRetry = false): Promise<void> {
    let addedCount = 0;
    for (const asset of assets) {
      const exists = this.uploadQueue.find(a => a.id === asset.id);
      if (!exists) {
        this.uploadQueue.push(asset);
        addedCount++;
      }
    }

    if (addedCount > 0) {
      await this.saveQueue();
      console.log(`Added ${addedCount} assets to upload queue`);

      // Unpause queue if this is a manual retry
      this.maybeUnpauseForManualRetry(isManualRetry);

      this.processQueue();
    }
  }

  /**
   * Unpause upload queue if user is manually retrying
   * Manual retry indicates they may have resolved the issue (e.g., added credits)
   */
  private maybeUnpauseForManualRetry(isManualRetry: boolean): void {
    if (isManualRetry && this.isPaused) {
      console.log('Unpausing upload queue for manual retry');
      this.setPaused(false);
    }
  }

  /**
   * Remove an asset from the queue
   */
  async removeFromQueue(assetId: string): Promise<void> {
    this.uploadQueue = this.uploadQueue.filter(a => a.id !== assetId);
    await this.saveQueue();
  }

  /**
   * Save upload queue IDs to storage
   * Only stores IDs, not full asset data
   */
  private async saveQueue(): Promise<void> {
    const queueIds = this.uploadQueue.map(asset => asset.id);
    await this.metadataStorage.setUploadQueueIds(queueIds);
  }

  /**
   * Set paused state
   */
  setPaused(paused: boolean): void {
    this.isPaused = paused;
    if (!paused) {
      this.processQueue();
    }
  }

  /**
   * Register progress callback for an asset
   */
  onProgress(assetId: string, callback: (progress: UploadProgress) => void): void {
    this.progressCallbacks.set(assetId, callback);
  }

  /**
   * Register completion callback for uploads
   */
  onUploadComplete(callback: (assetId: string) => void): void {
    // Use a unique key for the callback
    const key = `completion_${Date.now()}_${Math.random()}`;
    this.completionCallbacks.set(key, callback);
  }

  /**
   * Emit progress update
   */
  private emitProgress(update: UploadProgress): void {
    const callback = this.progressCallbacks.get(update.assetId);
    if (callback) {
      callback(update);
    }

    // Also send message to popup/options pages
    chrome.runtime.sendMessage({
      type: 'UPLOAD_PROGRESS',
      payload: update,
    }).catch(() => {
      // Ignore errors if no listeners
    });
  }

  /**
   * Emit completion notification
   */
  private emitCompletion(assetId: string): void {
    // Notify completion callbacks (e.g., service worker for badge updates)
    this.completionCallbacks.forEach((callback) => {
      try {
        callback(assetId);
      } catch (error) {
        console.error('Error in completion callback:', error);
      }
    });

    // Also send message to popup/options pages for UI updates
    chrome.runtime.sendMessage({
      type: 'UPLOAD_COMPLETE',
      payload: { assetId },
    }).catch(() => {
      // Ignore errors if no listeners
    });
  }

  /**
   * Process the upload queue
   */
  private async processQueue(): Promise<void> {
    if (this.isUploading || this.isPaused || this.uploadQueue.length === 0) {
      return;
    }

    this.isUploading = true;
    const asset = this.uploadQueue.shift();

    if (!asset) {
      this.isUploading = false;
      return;
    }

    try {
      await this.uploadAsset(asset);
    } catch (error) {
      console.error('Upload failed:', error);
      await this.handleUploadError(asset, error);
    }

    await this.saveQueue();
    this.isUploading = false;
    this.processQueue(); // Continue with next asset
  }

  /**
   * Upload a single asset
   */
  private async uploadAsset(asset: Asset): Promise<void> {
    console.log('Starting upload for asset:', asset.id);

    await this.updateAssetStatusToUploading(asset);
    const progressInterval = this.startProgressSimulation(asset);

    try {
      const formData = await this.prepareUploadFormData(asset);
      const result = await this.apiClient.postWithAuth<any>('/assets/', formData);

      clearInterval(progressInterval);
      console.log('Upload successful:', result);

      await this.handleUploadSuccess(asset, result);
    } catch (error) {
      clearInterval(progressInterval);
      throw error;
    }
  }

  /**
   * Update asset status to uploading and emit initial progress
   */
  private async updateAssetStatusToUploading(asset: Asset): Promise<void> {
    asset.status = 'uploading';

    // Clear error metadata from previous failed upload attempts
    if (asset.metadata?.error) {
      delete asset.metadata.error;
    }
    if (asset.metadata?.errorType) {
      delete asset.metadata.errorType;
    }

    await this.assetStorage.updateAsset(asset.id, {
      status: 'uploading',
      metadata: asset.metadata
    });
    
    this.emitProgress({
      assetId: asset.id,
      progress: 0,
      status: 'uploading',
    });
  }

  /**
   * Start simulating progress updates for an uploading asset
   */
  private startProgressSimulation(asset: Asset): ReturnType<typeof setInterval> {
    return setInterval(() => {
      const currentProgress = asset.metadata?.uploadProgress || 0;
      if (currentProgress < 0.9) {
        const newProgress = currentProgress + 0.1;
        asset.metadata = { ...asset.metadata, uploadProgress: newProgress };
        this.emitProgress({
          assetId: asset.id,
          progress: newProgress,
          status: 'uploading',
        });
      }
    }, 500);
  }

  /**
   * Prepare FormData for asset upload
   */
  private async prepareUploadFormData(asset: Asset): Promise<FormData> {
    const blob = await this.dataUrlToBlob(asset.uri);

    const formData = new FormData();
    const filename = `screenshot_${Date.now()}.${asset.mimeType.split('/')[1]}`;
    formData.append('asset_file', blob, filename);

    const signedMetadata = this.createSignedMetadata(asset);
    formData.append('signed_metadata', signedMetadata);

    if (asset.metadata?.caption) {
      formData.append('caption', asset.metadata.caption);
    }
    if (asset.metadata?.tag) {
      formData.append('tag', asset.metadata.tag);
    }

    return formData;
  }

  /**
   * Handle successful upload: update asset, clean up, and notify
   */
  private async handleUploadSuccess(asset: Asset, result: any): Promise<void> {
    // Update asset with uploaded status and metadata
    asset.status = 'uploaded';
    asset.metadata = {
      ...asset.metadata,
      uploadedAt: new Date().toISOString(),
      cid: result.cid,
      nid: result.nid,
      uploadProgress: 1,
    };

    await this.assetStorage.updateAsset(asset.id, {
      status: 'uploaded',
      metadata: asset.metadata,
    });

    this.emitProgress({
      assetId: asset.id,
      progress: 1,
      status: 'uploaded',
    });

    // Clean up: delete uploaded asset from IndexedDB to save disk space
    await this.assetStorage.deleteAsset(asset.id);
    console.log('Deleted uploaded asset from local storage:', asset.id);

    // Notify completion
    this.emitCompletion(asset.id);
  }

  /**
   * Handle upload error
   */
  private async handleUploadError(asset: Asset, error: any): Promise<void> {
    const errorMessage = error?.message || 'Upload failed';
    
    // Check for insufficient balance
    let errorType;
    if (this.isInsufficientBalanceError(error)) {
      console.warn('Insufficient balance detected, pausing uploads');
      this.setPaused(true);
      errorType = 'insufficient_credits';

      // Reset notification dismissal to show alert for this insufficient credits error
      // User may have dismissed it previously, but needs to be notified of the new failure
      await this.metadataStorage.clearInsufficientCreditsNotificationDismissed();
    }

    // Update asset status
    asset.status = 'failed';
    asset.metadata = {
      ...asset.metadata,
      error: errorMessage,
      errorType,
    };

    await this.assetStorage.updateAsset(asset.id, {
      status: 'failed',
      metadata: asset.metadata,
    });

    this.emitProgress({
      assetId: asset.id,
      progress: 0,
      status: 'failed',
      error: errorMessage,
    });
  }

  /**
   * Check if error is due to insufficient balance
   */
  private isInsufficientBalanceError(error: any): boolean {
    if (error?.data?.error?.type === 'asset_commit_insufficient_fund') {
      return true;
    }
    const message = error?.message?.toLowerCase() || '';
    return message.includes('insufficient') &&
           (message.includes('fund') || message.includes('balance') || message.includes('credit'));
  }

  /**
   * Convert data URL to Blob
   */
  private async dataUrlToBlob(dataUrl: string): Promise<Blob> {
    const response = await fetch(dataUrl);
    return await response.blob();
  }

  /**
   * Create signed metadata for upload
   */
  private createSignedMetadata(asset: Asset): string {
    const metadata: any = {
      spec_version: '2.0.0',
      recorder: 'ProofSnap Browser Extension',
      created_at: asset.createdAt,
    };

    // Add GPS location if available
    if (asset.gpsLocation) {
      metadata.location_latitude = asset.gpsLocation.latitude;
      metadata.location_longitude = asset.gpsLocation.longitude;
    }

    // Add website source information if available
    if (asset.sourceWebsite) {
      metadata.web_source_url = asset.sourceWebsite.url;
      metadata.web_source_title = asset.sourceWebsite.title;
    }

    // Sort keys for consistency
    const sortedKeys = Object.keys(metadata).sort();
    return JSON.stringify(metadata, sortedKeys, 2);
  }

  /**
   * Get current queue status
   */
  getQueueStatus(): {
    total: number;
    uploading: boolean;
    paused: boolean;
  } {
    return {
      total: this.uploadQueue.length,
      uploading: this.isUploading,
      paused: this.isPaused,
    };
  }

  /**
   * Retry failed uploads
   */
  async retryFailedUploads(): Promise<void> {
    const assets = await this.assetStorage.getAllAssets();
    const failedAssets = assets.filter(a => a.status === 'failed');
    
    if (failedAssets.length > 0) {
      console.log(`Retrying ${failedAssets.length} failed uploads`);
      // Pass isManualRetry=true to unpause queue if it was paused
      await this.addMultipleToQueue(failedAssets, true);
    }
  }
}
