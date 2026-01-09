import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: 'manifest.json',
          dest: '.'
        },
        {
          src: 'public/*',
          dest: '.'
        },
        {
          src: 'src/offscreen/offscreen.html',
          dest: 'src/offscreen'
        },
        {
          src: 'src/share/share.html',
          dest: '.'
        }
      ]
    })
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/popup.html'),
        options: resolve(__dirname, 'src/options/options.html'),
        background: resolve(__dirname, 'src/background/service-worker.ts'),
        offscreen: resolve(__dirname, 'src/offscreen/offscreen.ts'),
        share: resolve(__dirname, 'src/share/share.tsx'),
        'content/selection-overlay': resolve(__dirname, 'src/content/selection-overlay.ts')
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: '[name].[ext]'
      }
    }
  }
});
