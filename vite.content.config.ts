import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * Separate Vite config for content scripts.
 *
 * Content scripts injected via chrome.scripting.executeScript must be
 * completely self-contained — they cannot resolve ES module chunk imports
 * at runtime. Building content scripts as a single-entry point ensures that
 * all static imports are bundled inline and no shared chunks are emitted.
 */
export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: {
        'content/selection-overlay': resolve(__dirname, 'src/content/selection-overlay.ts')
      },
      output: {
        entryFileNames: '[name].js',
        assetFileNames: '[name].[ext]'
      }
    }
  }
});
