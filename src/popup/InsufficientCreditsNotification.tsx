/**
 * Insufficient Credits Notification Component
 * Displays a message when upload fails due to insufficient credits
 */

interface InsufficientCreditsNotificationProps {
  onClose: () => void;
}

export default function InsufficientCreditsNotification({ onClose }: InsufficientCreditsNotificationProps) {
  const handleGetCredits = () => {
    chrome.tabs.create({
      url: 'https://dashboard.captureapp.xyz/main?tab=wallet',
    });
    onClose();
  };

  return (
    <div className="notification-overlay">
      <div className="notification-card insufficient-credits">
        <div className="notification-header">
          <span className="notification-icon">💳</span>
          <h3>Insufficient Credits</h3>
          <button className="notification-close" onClick={onClose}>×</button>
        </div>
        <div className="notification-body">
          <p>Your upload failed because you don't have enough credits.</p>
          <p className="hint">Get more credits to continue uploading your screenshots to the blockchain.</p>
        </div>
        <div className="notification-actions">
          <button className="primary-button" onClick={handleGetCredits}>
            Get More Credits
          </button>
          <button className="secondary-button" onClick={onClose}>
            Maybe Later
          </button>
        </div>
      </div>
    </div>
  );
}
