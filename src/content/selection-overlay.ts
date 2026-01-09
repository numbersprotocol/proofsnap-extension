/**
 * Selection Overlay Content Script
 * Allows users to select a region of the page for screenshot capture
 */

// Prevent multiple injections
if (!(window as any).__proofSnapSelectionActive) {
  (window as any).__proofSnapSelectionActive = true;

  interface SelectionCoordinates {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  let overlay: HTMLDivElement | null = null;
  let selectionBox: HTMLDivElement | null = null;
  let isSelecting = false;
  let startX = 0;
  let startY = 0;

  /**
   * Initialize the selection overlay
   */
  function initSelectionOverlay(): void {
    // Create dark overlay
    overlay = document.createElement('div');
    overlay.id = 'proofsnap-selection-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.5);
      z-index: 2147483647;
      cursor: crosshair;
      user-select: none;
    `;

    // Create selection box
    selectionBox = document.createElement('div');
    selectionBox.id = 'proofsnap-selection-box';
    selectionBox.style.cssText = `
      position: fixed;
      border: 2px dashed #fff;
      background: transparent;
      box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5);
      z-index: 2147483647;
      display: none;
      pointer-events: none;
    `;

    // Create instructions tooltip
    const instructions = document.createElement('div');
    instructions.id = 'proofsnap-instructions';
    instructions.innerHTML = `
      <div style="
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 14px;
        z-index: 2147483647;
        pointer-events: none;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      ">
        <strong>ProofSnap</strong> - Click and drag to select area. Press <kbd style="
          background: rgba(255,255,255,0.2);
          padding: 2px 6px;
          border-radius: 4px;
          margin: 0 4px;
        ">Esc</kbd> to cancel.
      </div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(selectionBox);
    document.body.appendChild(instructions);

    // Add event listeners
    overlay.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('keydown', handleKeyDown);
  }

  /**
   * Handle mouse down - start selection
   */
  function handleMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return; // Only left click
    
    isSelecting = true;
    startX = e.clientX;
    startY = e.clientY;

    if (selectionBox) {
      selectionBox.style.display = 'block';
      selectionBox.style.left = `${startX}px`;
      selectionBox.style.top = `${startY}px`;
      selectionBox.style.width = '0px';
      selectionBox.style.height = '0px';
    }

    // Hide overlay background while selecting (selection box has its own shadow)
    if (overlay) {
      overlay.style.background = 'transparent';
    }
  }

  /**
   * Handle mouse move - update selection box
   */
  function handleMouseMove(e: MouseEvent): void {
    if (!isSelecting || !selectionBox) return;

    const currentX = e.clientX;
    const currentY = e.clientY;

    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);

    selectionBox.style.left = `${left}px`;
    selectionBox.style.top = `${top}px`;
    selectionBox.style.width = `${width}px`;
    selectionBox.style.height = `${height}px`;
  }

  /**
   * Handle mouse up - complete selection
   */
  function handleMouseUp(e: MouseEvent): void {
    if (!isSelecting) return;
    
    isSelecting = false;

    const currentX = e.clientX;
    const currentY = e.clientY;

    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);

    // Minimum selection size
    if (width < 10 || height < 10) {
      cleanup();
      sendResponse({ cancelled: true, reason: 'Selection too small' });
      return;
    }

    // Calculate coordinates relative to page (accounting for scroll and device pixel ratio)
    const dpr = window.devicePixelRatio || 1;
    const coordinates: SelectionCoordinates = {
      x: Math.round(left * dpr),
      y: Math.round(top * dpr),
      width: Math.round(width * dpr),
      height: Math.round(height * dpr),
    };

    cleanup();
    sendResponse({ 
      cancelled: false, 
      coordinates,
      viewportCoordinates: { x: left, y: top, width, height }
    });
  }

  /**
   * Handle key down - cancel on Escape
   */
  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      cleanup();
      sendResponse({ cancelled: true, reason: 'User cancelled' });
    }
  }

  /**
   * Send response back to service worker
   */
  function sendResponse(data: any): void {
    chrome.runtime.sendMessage({
      type: 'SELECTION_COMPLETE',
      payload: data,
    });
  }

  /**
   * Cleanup overlay elements
   */
  function cleanup(): void {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    document.removeEventListener('keydown', handleKeyDown);

    const elements = [
      'proofsnap-selection-overlay',
      'proofsnap-selection-box',
      'proofsnap-instructions',
    ];

    elements.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });

    overlay = null;
    selectionBox = null;
    (window as any).__proofSnapSelectionActive = false;
  }

  // Initialize on load
  initSelectionOverlay();
}
