# ProofSnap Browser Extension

Snap once. Prove forever. Turn your browser into a trust engine—sealing screenshots with cryptographic proof.

---

## 📋 AI Development Prompt

**Copy this prompt to your AI assistant (Claude, ChatGPT, etc.) to get instant help:**

```
I'm working with the ProofSnap browser extension repository. Here's what you need to know:

PROJECT OVERVIEW:
- Chrome browser extension that captures screenshots and registers them on Numbers Protocol blockchain
- Provides cryptographic proof of authenticity for screenshots with timestamps

TECH STACK:
- React 19 + TypeScript
- Vite (build tool)
- Chrome Extension Manifest V3
- Numbers Protocol API for blockchain integration

ARCHITECTURE:
- Service Worker (src/background/service-worker.ts): Background tasks, screenshot capture, upload queue
- Popup UI (src/popup/popup.tsx): Main extension interface - login, capture button, asset gallery
- Options Page (src/options/options.tsx): Settings and authentication
- Offscreen Document (src/offscreen/offscreen.ts): Canvas operations for watermarking
- Storage: chrome.storage.local for metadata, IndexedDB for image data
- API Integration: src/services/NumbersApiManager.ts manages all API calls

KEY FILES:
- manifest.json: Extension configuration and permissions
- src/services/ScreenshotService.ts: Screenshot capture logic
- src/services/UploadService.ts: Asset upload with retry logic
- src/offscreen/offscreen.ts: Canvas operations for watermarking
- src/services/StorageService.ts: Chrome storage abstraction

DEVELOPMENT:
- npm install: Install dependencies
- npm run dev: Development mode with hot reload
- npm run build: Production build (output to dist/)
- Load unpacked: chrome://extensions/ → Enable Developer mode → Load unpacked → Select dist/

API ENDPOINT: https://api.numbersprotocol.io/api/v3
Authentication: User email/password, token stored in chrome.storage

Please help me with this codebase.
```

---

## Features

- 📸 Capture screenshots with blockchain verification
- ⏰ Automatic timestamp watermarking
- 🔐 Numbers Protocol blockchain integration
- ☁️ Background upload queue with retry logic
- ⌨️ Keyboard shortcut support (Ctrl+Shift+S / Cmd+Shift+S)

## Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/numbersprotocol/proofsnap-extension.git
cd proofsnap-extension

# Install dependencies
npm install

# Build for production
npm run build
```

### Load Extension in Chrome

1. Build the extension: `npm run build`
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top right)
4. Click **Load unpacked**
5. Select the `dist/` folder from this project
6. The ProofSnap extension icon should appear in your toolbar

### Usage

1. Click the ProofSnap icon in your browser toolbar
2. Log in with your Numbers Protocol account (or sign up)
3. Click "📸 Snap" to capture the visible tab
4. Screenshots are automatically timestamped and uploaded to the blockchain
5. View your asset status in the popup and on your dashboard

## Development

### Development Mode

For active development with hot reload:

```bash
npm run dev
```

Then reload the extension in your browser:
1. Go to extensions page (`chrome://extensions/`)
2. Click the refresh icon on the ProofSnap extension

### Available Commands

```bash
npm run dev          # Development mode with auto-rebuild
npm run build        # Production build
npm run type-check   # TypeScript type checking
```

### Debugging

- **Popup console**: Right-click extension icon → Inspect popup
- **Background worker**: Extensions page → Service Worker → Inspect
- **Options page**: Right-click options page → Inspect

### Project Structure

```
proofsnap-extension/
├── src/
│   ├── background/       # Service worker for background tasks
│   ├── popup/            # Extension popup UI
│   ├── options/          # Settings page
│   ├── offscreen/        # Canvas operations for watermarking
│   ├── services/         # Business logic and API integration
│   ├── config/           # Environment configuration
│   └── types/            # TypeScript type definitions
├── public/               # Static assets (icons, images)
├── manifest.json         # Extension manifest (Manifest V3)
├── vite.config.ts        # Build configuration
└── package.json          # Dependencies and scripts
```

## Technology Stack

- **React 19** - Modern UI framework
- **TypeScript** - Type-safe development
- **Vite** - Fast build tooling
- **Chrome Extension Manifest V3** - Latest extension standard
- **Numbers Protocol API** - Blockchain verification

## How It Works

1. **Capture**: Extension captures screenshot using Chrome tabs API
2. **Watermark**: Adds timestamp watermark
3. **Upload**: Sends to Numbers Protocol API in background
4. **Verify**: Asset is registered on blockchain with cryptographic proof
5. **Store**: Local copy saved in Chrome storage for offline access

## API Integration

Connects to Numbers Protocol API at `https://api.numbersprotocol.io/api/v3`

Authentication uses email/password credentials. Assets are verified via blockchain to ensure authenticity and immutability.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### For External Contributors

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/proofsnap-extension.git`
3. Create your feature branch: `git checkout -b feature/amazing-feature`
4. Make your changes and commit: `git commit -m 'Add some amazing feature'`
5. Push to your fork: `git push origin feature/amazing-feature`
6. Open a Pull Request from your fork to our main repository

## Support

- **Issues**: [GitHub Issues](https://github.com/numbersprotocol/proofsnap-extension/issues)
- **Documentation**: [Numbers Protocol Docs](https://docs.numbersprotocol.io/)
- **Website**: [numbersprotocol.io](https://numbersprotocol.io/)

## License

GPLv3
