/**
 * IndexedDB Service for Browser Extension
 * Handles large data storage (assets with base64 images)
 *
 * Pure storage layer - no dependencies on other services
 */

export type AssetMetadata = Omit<Asset, 'uri'>;

const DB_NAME = 'ProofSnapDB';
const DB_VERSION = 1;
const STORE_NAME = 'assets';

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
   * Get all asset metadata (excludes the `uri` field to reduce memory usage)
   * Use this for list views where thumbnails are not needed
   */
  async getAllAssetMetadata(): Promise<AssetMetadata[]> {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const results: AssetMetadata[] = [];
      const request = store.openCursor();

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const { uri: _uri, ...metadata } = cursor.value as Asset;
          results.push(metadata);
          cursor.continue();
        } else {
          results.sort((a, b) => b.createdAt - a.createdAt);
          resolve(results);
        }
      };
      request.onerror = () => reject(new Error('Failed to get asset metadata'));
    });
  }

  /**
   * Get the total number of stored assets
   * Lightweight alternative to getAllAssets() for badge/count-only updates
   */
  async getAssetCount(): Promise<number> {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.count();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Failed to count assets'));
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
