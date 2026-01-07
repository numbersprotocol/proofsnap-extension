/**
 * Share Page
 * Opens after successful upload when Hunt Mode is enabled
 */

import { storageService } from '../services/StorageService';
import './share.css';

async function init() {
  // Get nid from URL params
  const params = new URLSearchParams(window.location.search);
  const nid = params.get('nid');
  
  if (!nid) {
    document.getElementById('root')!.innerHTML = '<p>No asset to share</p>';
    return;
  }

  // Get Hunt Mode settings
  const settings = await storageService.getSettings();
  const verifyUrl = `https://asset.captureapp.xyz/${nid}`;
  const shareText = `${settings.huntModeMessage} ${verifyUrl} ${settings.huntModeHashtags}`;
  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`;

  // Render UI
  document.getElementById('root')!.innerHTML = `
    <div class="share-container">
      <div class="share-icon">🎯</div>
      <h1 class="share-title">Snap Verified!</h1>
      <p class="share-subtitle">
        Your screenshot is now on the blockchain!<br>
        Share it on X to join the AI Hunt event.
      </p>
      
      <div class="verify-link">
        <a href="${verifyUrl}" target="_blank">${verifyUrl}</a>
      </div>

      <div class="share-buttons">
        <button class="share-btn share-btn-x" id="shareX">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
          </svg>
          Share on X
        </button>
        
        <button class="share-btn share-btn-copy" id="copyLink">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          Copy Verification Link
        </button>
        
        <button class="share-btn share-btn-close" id="closeBtn">
          Maybe Later
        </button>
      </div>
    </div>
    <div class="copied-toast" id="toast">Link copied!</div>
  `;

  // Event listeners
  document.getElementById('shareX')!.addEventListener('click', () => {
    window.open(twitterUrl, '_blank');
  });

  document.getElementById('copyLink')!.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(verifyUrl);
      const toast = document.getElementById('toast')!;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  });

  document.getElementById('closeBtn')!.addEventListener('click', () => {
    window.close();
  });
}

init();
