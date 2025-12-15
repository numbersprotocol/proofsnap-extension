/**
 * Popup React Application
 * Main UI for the ProofSnap extension
 */

import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { indexedDBService, type Asset } from '../services/IndexedDBService';
import { storageService } from '../services/StorageService';
import LoginForm from './LoginForm';
import InsufficientCreditsNotification from './InsufficientCreditsNotification';
import { getNumbersApi } from '../services/NumbersApiManager';
import './popup.css';

/**
 * Main Popup Component
 */
function PopupApp() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [username, setUsername] = useState<string>('');
  const [showInsufficientCreditsNotification, setShowInsufficientCreditsNotification] = useState(false);

  useEffect(() => {
    loadInitialData();
  }, []);

  async function loadInitialData() {
    setIsLoading(true);
    try {
      const numbersApi = await getNumbersApi();
      const authenticated = numbersApi.auth.isAuthenticated();
      setIsAuthenticated(authenticated);

      // Get username for dashboard link
      if (authenticated) {
        const auth = await storageService.getAuth();
        if (auth?.username) {
          setUsername(auth.username);
        }
      }

      // Get assets from IndexedDB (upload queue: drafts, uploading, failed)
      // Successfully uploaded assets are deleted to save disk space
      const assets = await indexedDBService.getAllAssets();
      setAssets(assets);

      // Check for insufficient credits error
      await checkCreditStatus(assets);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCapture() {
    setCapturing(true);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CAPTURE_SCREENSHOT',
        payload: {
          mode: 'visible',
        },
      });

      if (response.success) {
        console.log('Screenshot captured:', response.data);
        // Reload assets from IndexedDB
        const assets = await indexedDBService.getAllAssets();
        setAssets(assets);
      } else {
        console.error('Capture failed:', response.error);
        alert('Failed to capture screenshot: ' + response.error);
      }
    } catch (error) {
      console.error('Capture error:', error);
      alert('Failed to capture screenshot');
    } finally {
      setCapturing(false);
    }
  }

  async function handleUpload(assetId: string) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'UPLOAD_ASSET',
        payload: { assetId },
      });

      if (response.success) {
        console.log('Asset queued for upload');
        // No need to reload - UPLOAD_PROGRESS listener will handle it
      } else {
        alert('Failed to queue upload: ' + response.error);
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('Failed to upload asset');
    }
  }

  function openOptions() {
    chrome.runtime.openOptionsPage();
  }

  function openDashboard() {
    if (username) {
      chrome.tabs.create({
        url: `https://dashboard.captureapp.xyz/showcase/${username}`,
      });
    }
  }

  async function checkCreditStatus(currentAssets: Asset[]) {
    // Check if any asset failed due to insufficient credits
    const hasCreditError = currentAssets.some(
      asset => asset.status === 'failed' && asset.metadata?.errorType === 'insufficient_credits'
    );

    if (hasCreditError) {
      // Only show notification if user hasn't dismissed it yet
      const dismissed = await storageService.hasInsufficientCreditsNotificationDismissed();
      if (!dismissed) {
        setShowInsufficientCreditsNotification(true);
      }
    }
  }

  async function handleCloseNotification() {
    setShowInsufficientCreditsNotification(false);
    // Mark as dismissed so we don't show it again until they successfully upload
    await storageService.setInsufficientCreditsNotificationDismissed(true);
  }

  // Listen for upload progress updates
  useEffect(() => {
    const handleMessage = async (message: any) => {
      if (message.type === 'UPLOAD_PROGRESS') {
        // Reload assets to show updated progress
        const assets = await indexedDBService.getAllAssets();
        setAssets(assets);
        await checkCreditStatus(assets);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  if (isLoading) {
    return (
      <div className="popup-container">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="popup-container">
        <div className="header">
          <h1>ProofSnap</h1>
          <p>Snap once. Prove forever.</p>
        </div>
        <div className="content">
          <LoginForm onLogin={() => {
            // After login, reload initial data
            loadInitialData();
          }} />
        </div>
      </div>
    );
  }

  return (
    <div className="popup-container">
      <div className="header">
        <h1>ProofSnap</h1>
        <button className="icon-button" onClick={openOptions} title="Settings">
          ⚙️
        </button>
      </div>

      {showInsufficientCreditsNotification && (
        <InsufficientCreditsNotification
          onClose={handleCloseNotification}
        />
      )}

      <div className="capture-section">
        <button
          className="capture-button"
          onClick={handleCapture}
          disabled={capturing}
        >
          {capturing ? '📸 Snapping...' : '📸 Snap'}
        </button>
      </div>

      <div className="content">
        <div className="section-header">
          <h2>Asset Status</h2>
          <span className="count">{assets.length}</span>
        </div>

        {assets.length === 0 ? (
          <div className="empty-state">
            <p>Nothing in progress</p>
            <p className="hint">Assets appear here when captured. Successful uploads are automatically removed (view them on your dashboard). Failed ones stay visible - click to retry.</p>
          </div>
        ) : (
          <div className="asset-grid">
            {assets.slice(0, 6).map((asset) => (
              <AssetThumbnail key={asset.id} asset={asset} onUpload={handleUpload} />
            ))}
          </div>
        )}
      </div>

      <div className="footer">
        <button className="link-button" onClick={openDashboard}>
          View on Dashboard →
        </button>
      </div>
    </div>
  );
}

/**
 * Asset Thumbnail Component
 */
function AssetThumbnail({ asset, onUpload }: { asset: Asset; onUpload?: (assetId: string) => void }) {
  const date = new Date(asset.createdAt);
  const statusColors: Record<string, string> = {
    draft: '#808080',
    uploading: '#FFA500',
    uploaded: '#21B76E',
    failed: '#FF5560',
  };

  const statusIcons: Record<string, string> = {
    draft: '📄',
    uploading: '⏫',
    uploaded: '✅',
    failed: '❌',
  };

  const handleUploadClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onUpload && (asset.status === 'draft' || asset.status === 'failed')) {
      onUpload(asset.id);
    }
  };

  const handleViewOnBlockchain = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (asset.metadata?.nid) {
      // Open Numbers Protocol asset page in new tab
      chrome.tabs.create({
        url: `https://verify.numbersprotocol.io/asset-profile/${asset.metadata.nid}`,
      });
    }
  };

  return (
    <div className="asset-thumbnail">
      <img src={asset.uri} alt="Screenshot" />
      <div className="asset-info">
        <div className="asset-meta">
          <div className="asset-date">{date.toLocaleDateString()}</div>
          {asset.sourceWebsite && (() => {
            try {
              const hostname = new URL(asset.sourceWebsite.url).hostname;
              return (
                <div className="asset-website" title={asset.sourceWebsite.url}>
                  🌐 {hostname}
                </div>
              );
            } catch {
              return null;
            }
          })()}
        </div>
        {asset.status === 'uploaded' && asset.metadata?.nid ? (
          <div
            className="asset-status blockchain-link"
            style={{ backgroundColor: statusColors[asset.status] }}
            onClick={handleViewOnBlockchain}
            title="View on blockchain"
          >
            {statusIcons[asset.status]} Verified 🔗
          </div>
        ) : (
          <div
            className="asset-status"
            style={{ backgroundColor: statusColors[asset.status] || '#808080' }}
            onClick={handleUploadClick}
            title={
              asset.status === 'draft' ? 'Click to upload' :
                asset.status === 'failed' ?
                  (asset.metadata?.errorType === 'insufficient_credits' ?
                    'Upload failed: Insufficient credits. Click to retry.' :
                    'Click to retry upload') :
                  asset.status
            }
          >
            {statusIcons[asset.status] || ''} {
              asset.status === 'failed' && asset.metadata?.errorType === 'insufficient_credits'
                ? 'No credits'
                : asset.status
            }
          </div>
        )}
      </div>
      {asset.status === 'uploading' && asset.metadata?.uploadProgress && (
        <div className="upload-progress">
          <div
            className="upload-progress-bar"
            style={{ width: `${(asset.metadata.uploadProgress * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

// Mount React app
const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(<PopupApp />);
}
