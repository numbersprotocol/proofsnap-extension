/**
 * IndexedDB Service for Browser Extension
 * Handles large data storage (assets with base64 images)
 *
 * Pure storage layer - no dependencies on other services
 */

const DB_NAME = 'ProofSnapDB';
const DB_VERSION = 1;
const STORE_NAME = 'assets';

// Storage limits to prevent local DoS via storage exhaustion
const MAX_STORED_ASSETS = 50;
const FAILED_ASSET_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Asset type for browser extension storage
export interface Asset {
  id: string;
  uri: string;
  type: 'image' | 'video';
  mimeType: string;
  createdAt: number;
  status: 'draft' | 'uploading' | 'uploaded' | 'failed';
  metadata?: {
    uploadedAt?: string;
    width?: number;
    height?: number;
    [key: string]: any;
  };
  gpsLocation?: {
    latitude: number;
    longitude: number;
    accuracy: number;
    timestamp: number;
  };
  sourceWebsite?: {
    url: string;
    title: string;
  };
}

/**
 * IndexedDB wrapper for asset storage
 */
export class IndexedDBService {
  private db: IDBDatabase | null = null;

  /**
   * Initialize the database
   */
  async init(): Promise<void> {
    if (this.db) return; // Already initialized

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        reject(new Error('Failed to open IndexedDB'));
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'id' });

          // Create indexes for efficient queries
          objectStore.createIndex('status', 'status', { unique: false });
          objectStore.createIndex('createdAt', 'createdAt', { unique: false });
          objectStore.createIndex('type', 'type', { unique: false });
        }
      };
    });
  }


  /**
   * Ensure database is initialized
   */
  private async ensureDB(): Promise<IDBDatabase> {
    if (!this.db) {
      await this.init();
    }
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return this.db;
  }

  /**
   * Add or update an asset
   */
  async setAsset(asset: Asset): Promise<void> {
    const db = await this.ensureDB();

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(asset);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to store asset'));
    });

    // Enforce storage limits after adding the asset
    await this.pruneAssets();
  }

  /**
   * Remove failed assets older than FAILED_ASSET_TTL_MS and enforce MAX_STORED_ASSETS limit
   */
  async pruneAssets(): Promise<void> {
    const assets = await this.getAllAssets();

    const now = Date.now();

    // Delete failed assets that exceed the TTL
    const expiredFailed = assets.filter(
      a => a.status === 'failed' && now - a.createdAt > FAILED_ASSET_TTL_MS
    );
    for (const asset of expiredFailed) {
      await this.deleteAsset(asset.id);
    }

    // Re-fetch after deletion to check count
    const remaining = await this.getAllAssets();
    if (remaining.length > MAX_STORED_ASSETS) {
      // Remove oldest assets (sorted newest-first, so remove from the end)
      const toRemove = remaining.slice(MAX_STORED_ASSETS);
      for (const asset of toRemove) {
        await this.deleteAsset(asset.id);
      }
    }
  }

  /**
   * Get a single asset by ID
   */
  async getAsset(id: string): Promise<Asset | null> {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => {
        resolve(request.result || null);
      };
      request.onerror = () => reject(new Error('Failed to get asset'));
    });
  }

  /**
   * Get all assets
   */
  async getAllAssets(): Promise<Asset[]> {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const assets = request.result || [];
        // Sort by createdAt descending (newest first)
        assets.sort((a, b) => b.createdAt - a.createdAt);
        resolve(assets);
      };
      request.onerror = () => reject(new Error('Failed to get assets'));
    });
  }

  /**
   * Update an asset
   */
  async updateAsset(id: string, updates: Partial<Asset>): Promise<void> {
    const asset = await this.getAsset(id);
    if (!asset) {
      throw new Error(`Failed to update asset: Asset with ID '${id}' not found in IndexedDB`);
    }

    const updated = { ...asset, ...updates };
    await this.setAsset(updated);
  }

  /**
   * Delete an asset
   */
  async deleteAsset(id: string): Promise<void> {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to delete asset'));
    });
  }
}

// Export singleton instance
export const indexedDBService = new IndexedDBService();
