/**
 * Popup React Application
 * Main UI for the ProofSnap extension
 */

import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { indexedDBService, type Asset } from '../services/IndexedDBService';
import { storageService } from '../services/StorageService';
import AuthForm from './AuthForm';
import InsufficientCreditsNotification from './InsufficientCreditsNotification';
import { getNumbersApi } from '../services/NumbersApiManager';
import './popup.css';

/**
 * Hunt Mode settings interface for popup
 */
interface HuntModeConfig {
  enabled: boolean;
  message: string;
  hashtags: string;
}

/**
 * Main Popup Component
 */
function PopupApp() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [captureMode, setCaptureMode] = useState<'visible' | 'selection'>('visible');
  const [username, setUsername] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [showInsufficientCreditsNotification, setShowInsufficientCreditsNotification] = useState(false);
  const [huntMode, setHuntMode] = useState<HuntModeConfig>({ enabled: false, message: '', hashtags: '' });
  const [sharePromptAsset, setSharePromptAsset] = useState<Asset | null>(null);

  useEffect(() => {
    loadInitialData();
  }, []);

  async function loadInitialData() {
    setIsLoading(true);
    try {
      const numbersApi = await getNumbersApi();
      const authenticated = numbersApi.auth.isAuthenticated();
      setIsAuthenticated(authenticated);

      // Get username and email for dashboard link and UI
      if (authenticated) {
        const auth = await storageService.getAuth();
        if (auth?.username) {
          setUsername(auth.username);
        }
        if (auth?.email) {
          setEmail(auth.email);
        }
      }

      // Get assets from IndexedDB (upload queue: drafts, uploading, failed)
      // Successfully uploaded assets are deleted to save disk space
      const assets = await indexedDBService.getAllAssets();
      setAssets(assets);

      // Load Hunt Mode settings
      const settings = await storageService.getSettings();
      const huntModeActive = settings.huntModeEnabled;
      console.log('[Hunt Mode Popup] Settings:', { huntModeEnabled: settings.huntModeEnabled, huntModeActive });
      setHuntMode({
        enabled: huntModeActive,
        message: settings.huntModeMessage,
        hashtags: settings.huntModeHashtags,
      });

      // Check for pending share prompt (from upload that completed while popup was closed)
      if (huntModeActive) {
        const pendingNid = await storageService.getAndClearPendingShare();
        console.log('[Hunt Mode Popup] Pending NID:', pendingNid);
        if (pendingNid) {
          setSharePromptAsset({
            id: 'pending',
            uri: '',
            status: 'uploaded',
            createdAt: new Date().toISOString(),
            metadata: { nid: pendingNid },
          } as any);
        }
      }

      // Check for insufficient credits error
      await checkCreditStatus(assets);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCapture(mode: 'visible' | 'selection' = captureMode) {
    setCapturing(true);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CAPTURE_SCREENSHOT',
        payload: {
          mode: mode,
        },
      });

      if (response.success) {
        console.log('Screenshot captured:', response.data);
        // Reload assets from IndexedDB
        const assets = await indexedDBService.getAllAssets();
        setAssets(assets);
      } else if (response.cancelled) {
        // User cancelled selection - do nothing
        console.log('Screenshot cancelled');
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

    // Early exit if notification is already showing - avoid redundant storage queries
    if (showInsufficientCreditsNotification) {
      return;
    }

    if (hasCreditError) {
      // Only query storage if we're considering showing the notification
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

  async function handleLogout() {
    if (confirm('Are you sure you want to logout?')) {
      const numbersApi = await getNumbersApi();
      await numbersApi.clearAuth();
      setIsAuthenticated(false);
      setUsername('');
      setEmail('');
      // Force reload to switch to login view
      window.location.reload();
    }
  }

  // Listen for upload progress updates
  useEffect(() => {
    const handleMessage = async (message: any) => {
      if (message.type === 'UPLOAD_PROGRESS') {
        const payload = message.payload;
        
        // Reload assets to show updated progress
        const updatedAssets = await indexedDBService.getAllAssets();
        setAssets(updatedAssets);
        await checkCreditStatus(updatedAssets);

        // In Hunt Mode, show share prompt when upload succeeds
        if (huntMode.enabled && payload?.status === 'uploaded' && payload?.nid) {
          // Asset is deleted after upload, so create a minimal object for share prompt
          setSharePromptAsset({
            id: payload.assetId,
            uri: '', // We don't have the image anymore, modal will handle this
            status: 'uploaded',
            createdAt: new Date().toISOString(),
            metadata: { nid: payload.nid },
          } as any);
        }
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [showInsufficientCreditsNotification, huntMode.enabled]); // Add huntMode dependency

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
        <div className="content auth-content">
          <AuthForm onLogin={() => {
            // Force reload to ensure fresh API instance and UI state.
            // This is consistent with handleLogout and fixes stale singleton issues.
            window.location.reload();
          }} />
        </div>
      </div>
    );
  }

  return (
    <div className="popup-container">
      <PopupHeader
        username={username}
        email={email}
        onLogout={handleLogout}
        onOpenOptions={openOptions}
      />

      {showInsufficientCreditsNotification && (
        <InsufficientCreditsNotification
          onClose={handleCloseNotification}
        />
      )}

      <CaptureSection
        capturing={capturing}
        captureMode={captureMode}
        onCaptureMode={setCaptureMode}
        onCapture={handleCapture}
      />

      <AssetList
        assets={assets}
        onUpload={handleUpload}
        huntMode={huntMode}
      />

      {sharePromptAsset && (
        <SharePromptModal
          asset={sharePromptAsset}
          huntMode={huntMode}
          onClose={() => setSharePromptAsset(null)}
        />
      )}

      <PopupFooter onOpenDashboard={openDashboard} />
    </div>
  );
}

/**
 * Popup Header Component
 */
function PopupHeader({
  username,
  email,
  onLogout,
  onOpenOptions
}: {
  username: string;
  email: string;
  onLogout: () => void;
  onOpenOptions: () => void;
}) {
  return (
    <div className="header">
      <h1>ProofSnap</h1>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {/* Account Details */}
        <div className="account-details">
          <span className="account-username">{username || 'User'}</span>
          {email && <span className="account-email" title={email}>{email}</span>}
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="icon-button"
            onClick={onLogout}
            title="Logout"
            aria-label="Logout"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
          </button>
          <button
            className="icon-button"
            onClick={onOpenOptions}
            title="Settings"
            aria-label="Settings"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Capture Section Component
 */
function CaptureSection({
  capturing,
  captureMode,
  onCaptureMode,
  onCapture
}: {
  capturing: boolean;
  captureMode: 'visible' | 'selection';
  onCaptureMode: (mode: 'visible' | 'selection') => void;
  onCapture: (mode?: 'visible' | 'selection') => void;
}) {
  return (
    <div className="capture-section">
      {/* Capture Mode Toggle */}
      <div className="capture-mode-toggle" style={{ 
        display: 'flex', 
        gap: '4px', 
        marginBottom: '12px',
        background: 'rgba(0, 0, 0, 0.1)',
        borderRadius: '8px',
        padding: '4px'
      }}>
        <button
          className={`mode-button ${captureMode === 'visible' ? 'active' : ''}`}
          onClick={() => onCaptureMode('visible')}
          disabled={capturing}
          title="Capture visible area"
          style={{
            flex: 1,
            padding: '8px 12px',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            background: captureMode === 'visible' ? 'white' : 'transparent',
            color: captureMode === 'visible' ? '#1a1a1a' : '#666',
            boxShadow: captureMode === 'visible' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            transition: 'all 0.2s ease'
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
            <line x1="8" y1="21" x2="16" y2="21"></line>
            <line x1="12" y1="17" x2="12" y2="21"></line>
          </svg>
          Full Page
        </button>
        <button
          className={`mode-button ${captureMode === 'selection' ? 'active' : ''}`}
          onClick={() => onCaptureMode('selection')}
          disabled={capturing}
          title="Select area to capture"
          style={{
            flex: 1,
            padding: '8px 12px',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            background: captureMode === 'selection' ? 'white' : 'transparent',
            color: captureMode === 'selection' ? '#1a1a1a' : '#666',
            boxShadow: captureMode === 'selection' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            transition: 'all 0.2s ease'
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 3v4M3 5h4M21 5h-4M19 3v4M5 21v-4M3 19h4M21 19h-4M19 21v-4"></path>
            <rect x="7" y="7" width="10" height="10" rx="1"></rect>
          </svg>
          Select Area
        </button>
      </div>

      <button
        className="capture-button"
        onClick={() => onCapture()}
        disabled={capturing}
        aria-label="Capture screenshot"
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          {capturing ? (
            <>
              <span className="spinner-small" style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid white', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></span>
              Snapping...
            </>
          ) : (
            <>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                <circle cx="12" cy="13" r="4"></circle>
              </svg>
              Snap {captureMode === 'selection' ? 'Selection' : ''}
            </>
          )}
        </div>
      </button>
    </div>
  );
}

/**
 * Asset List Component
 */
function AssetList({
  assets,
  onUpload,
  huntMode
}: {
  assets: Asset[];
  onUpload: (id: string) => void;
  huntMode: HuntModeConfig;
}) {
  return (
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
            <AssetThumbnail key={asset.id} asset={asset} onUpload={onUpload} huntMode={huntMode} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Footer Component
 */
function PopupFooter({ onOpenDashboard }: { onOpenDashboard: () => void }) {
  return (
    <div className="footer">
      <button className="link-button" onClick={onOpenDashboard}>
        View on Dashboard →
      </button>
    </div>
  );
}

/**
 * Asset Thumbnail Component
 */
function AssetThumbnail({ asset, onUpload, huntMode }: { asset: Asset; onUpload?: (assetId: string) => void; huntMode?: HuntModeConfig }) {
  const date = new Date(asset.createdAt);
  const statusColors: Record<string, string> = {
    draft: '#808080',
    uploading: '#FFA500',
    uploaded: '#21B76E',
    failed: '#FF5560',
  };

  const statusIcons: Record<string, React.ReactNode> = {
    draft: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
        <polyline points="10 9 9 9 8 9"></polyline>
      </svg>
    ),
    uploading: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="17 8 12 3 7 8"></polyline>
        <line x1="12" y1="3" x2="12" y2="15"></line>
      </svg>
    ),
    uploaded: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
        <polyline points="22 4 12 14.01 9 11.01"></polyline>
      </svg>
    ),
    failed: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="15" y1="9" x2="9" y2="15"></line>
        <line x1="9" y1="9" x2="15" y2="15"></line>
      </svg>
    ),
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
        url: `https://asset.captureapp.xyz/${asset.metadata.nid}`,
      });
    }
  };

  const handleShareToX = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (asset.metadata?.nid && huntMode) {
      const verifyUrl = `https://asset.captureapp.xyz/${asset.metadata.nid}`;
      const text = `${huntMode.message} ${verifyUrl} ${huntMode.hashtags}`;
      const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
      chrome.tabs.create({ url: twitterUrl });
    }
  };

  const handleCopyLink = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (asset.metadata?.nid) {
      const verifyUrl = `https://asset.captureapp.xyz/${asset.metadata.nid}`;
      try {
        await navigator.clipboard.writeText(verifyUrl);
        // Could add toast notification here
      } catch (err) {
        console.error('Failed to copy:', err);
      }
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
                <div className="asset-website" title={asset.sourceWebsite.url} style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="2" y1="12" x2="22" y2="12"></line>
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                  </svg>
                  {hostname}
                </div>
              );
            } catch {
              return null;
            }
          })()}
        </div>
        {asset.status === 'uploaded' && asset.metadata?.nid ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div
              className="asset-status blockchain-link"
              style={{ backgroundColor: statusColors[asset.status], display: 'flex', alignItems: 'center', gap: '4px' }}
              onClick={handleViewOnBlockchain}
              title="View on blockchain"
            >
              {statusIcons[asset.status]} Verified
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
            </div>
            {/* Hunt Mode share buttons */}
            {huntMode?.enabled && (
              <div className="hunt-share-buttons" style={{ display: 'flex', gap: '4px' }}>
                <button
                  className="share-btn share-x"
                  onClick={handleShareToX}
                  title="Share on X"
                  style={{
                    flex: 1,
                    padding: '4px 6px',
                    border: 'none',
                    borderRadius: '4px',
                    background: '#000',
                    color: '#fff',
                    fontSize: '10px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '3px',
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                  </svg>
                  Share
                </button>
                <button
                  className="share-btn share-copy"
                  onClick={handleCopyLink}
                  title="Copy link"
                  style={{
                    padding: '4px 6px',
                    border: 'none',
                    borderRadius: '4px',
                    background: '#e5e5e7',
                    color: '#1d1d1f',
                    fontSize: '10px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div
            className="asset-status"
            style={{ backgroundColor: statusColors[asset.status] || '#808080', display: 'flex', alignItems: 'center', gap: '4px' }}
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

/**
 * Share Prompt Modal Component
 * Shows after successful upload in Hunt Mode
 */
function SharePromptModal({
  asset,
  huntMode,
  onClose
}: {
  asset: Asset;
  huntMode: HuntModeConfig;
  onClose: () => void;
}) {
  const verifyUrl = asset.metadata?.nid
    ? `https://asset.captureapp.xyz/${asset.metadata.nid}`
    : '';

  const handleShareToX = () => {
    const text = `${huntMode.message} ${verifyUrl} ${huntMode.hashtags}`;
    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
    chrome.tabs.create({ url: twitterUrl });
    onClose();
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(verifyUrl);
      onClose();
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="share-modal-overlay" style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.6)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '20px',
    }}>
      <div className="share-modal" style={{
        background: 'white',
        borderRadius: '16px',
        padding: '24px',
        maxWidth: '300px',
        width: '100%',
        textAlign: 'center',
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
      }}>
        <div style={{ marginBottom: '16px' }}>
          <span style={{ fontSize: '48px' }}>🎯</span>
        </div>
        <h3 style={{
          margin: '0 0 8px 0',
          fontSize: '18px',
          fontWeight: 600,
          color: '#1d1d1f',
        }}>
          Snap Verified!
        </h3>
        <p style={{
          margin: '0 0 20px 0',
          fontSize: '14px',
          color: '#86868b',
          lineHeight: 1.5,
        }}>
          Share your verified snap on X to participate in the AI Hunt event!
        </p>

        {/* Preview image - only show if we have it */}
        {asset.uri && (
          <div style={{
            marginBottom: '16px',
            borderRadius: '8px',
            overflow: 'hidden',
            border: '1px solid #e5e5e7',
          }}>
            <img
              src={asset.uri}
              alt="Screenshot"
              style={{
                width: '100%',
                height: '80px',
                objectFit: 'cover',
              }}
            />
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button
            onClick={handleShareToX}
            style={{
              width: '100%',
              padding: '12px 16px',
              border: 'none',
              borderRadius: '8px',
              background: '#000',
              color: '#fff',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              transition: 'transform 0.2s, box-shadow 0.2s',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
            Share on X
          </button>

          <button
            onClick={handleCopyLink}
            style={{
              width: '100%',
              padding: '12px 16px',
              border: '1px solid #d2d2d7',
              borderRadius: '8px',
              background: '#fff',
              color: '#1d1d1f',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            Copy Verification Link
          </button>

          <button
            onClick={onClose}
            style={{
              width: '100%',
              padding: '10px',
              border: 'none',
              borderRadius: '8px',
              background: 'transparent',
              color: '#86868b',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            Maybe Later
          </button>
        </div>
      </div>
    </div>
  );
}

// Mount React app
const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(<PopupApp />);
}
