/**
 * Share Page
 * Opens after successful upload when Hunt Mode is enabled
 */

import { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { storageService } from '../services/StorageService';
import './share.css';

function ShareApp() {
  const [verifyUrl, setVerifyUrl] = useState('');
  const [twitterUrl, setTwitterUrl] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function init() {
      const params = new URLSearchParams(window.location.search);
      const nid = params.get('nid');

      if (!nid) {
        setError('No asset to share');
        return;
      }

      const settings = await storageService.getSettings();
      const url = `https://asset.captureapp.xyz/${nid}`;
      const shareText = `${settings.huntModeMessage} ${url} ${settings.huntModeHashtags}`;
      setVerifyUrl(url);
      setTwitterUrl(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`);
    }

    init();
  }, []);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(verifyUrl);
      setToastVisible(true);
      setTimeout(() => setToastVisible(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  if (error) {
    return (
      <div className="share-container">
        <p>{error}</p>
      </div>
    );
  }

  return (
    <>
      <div className="share-container">
        <div className="share-icon">🎯</div>
        <h1 className="share-title">Snap Verified!</h1>
        <p className="share-subtitle">
          Your screenshot is now on the blockchain!<br />
          Share it on X to join the AI Hunt event.
        </p>

        <div className="verify-link">
          <a href={verifyUrl} target="_blank" rel="noreferrer">{verifyUrl}</a>
        </div>

        <div className="share-buttons">
          <a
            href={twitterUrl}
            target="_blank"
            rel="noreferrer"
            className="share-btn share-btn-x"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
            Share on X
          </a>

          <button className="share-btn share-btn-copy" onClick={handleCopyLink}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            Copy Verification Link
          </button>

          <button className="share-btn share-btn-close" onClick={() => window.close()}>
            Maybe Later
          </button>
        </div>
      </div>
      <div className={`copied-toast${toastVisible ? ' show' : ''}`}>Link copied!</div>
    </>
  );
}

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(<ShareApp />);
}
