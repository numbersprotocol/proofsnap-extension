# Workspace Context

<!-- This file is auto-maintained. The Repositories section is refreshed -->
<!-- by the system. The AI should maintain Environment & Key Discoveries. -->

**Workspace root (absolute path):** `/home/workspaces/conversations/e42f8a19-5d65-46b6-a008-ae3e31a703c2`

## Repositories

- **`proofsnap-extension/`** — Branch: `omni/e42f8a19/proofsnap-extension`, Remote: `numbersprotocol/proofsnap-extension`
  - Snap once. Prove forever. Turn your browser into a trust engine—sealing screenshots with cryptographic proof.

## Environment & Tools

- `proofsnap-extension/`: React 19 + TypeScript Chrome MV3 extension built with Vite; use `npm ci`, `npm run type-check`, `npm run lint`, and `npm run build`.
- Build requires `manifest.json`; generate it from `manifest.template.json` with `OAUTH_CLIENT_ID` and `EXTENSION_KEY` before `npm run build`.

## Key Discoveries

- Selection capture is coordinated in `src/background/service-worker.ts`: popup sends `CAPTURE_SCREENSHOT`, service worker injects the selection overlay, then receives `SELECTION_COMPLETE` and crops via the offscreen document.
- Popup runtime message listeners must ignore unrelated messages synchronously; an async listener can interfere with offscreen `ADD_WATERMARK` responses while the popup is open.
- Extension badge count is maintained by background `updateExtensionBadge()` from IndexedDB asset count; popup-side deletes should send `REFRESH_BADGE`.

---
_Last system refresh: 2026-05-06 07:28 UTC_
