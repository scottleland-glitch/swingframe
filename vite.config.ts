import { readFileSync, writeFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// GitHub Pages project site. Other sites on this account share the github.io
// origin, so the app, its service worker, and its caches stay under this path.
const BASE = '/swingframe/';

// vite-plugin-pwa appends the manifest and includeAssets after Workbox applies
// modifyURLPrefix, which would also cache those files at the github.io root.
// Drop any precache URL that is not under this app.
function precacheOnlyUnderBase(): Plugin {
  return {
    name: 'swingframe-precache-scope',
    apply: 'build',
    closeBundle: {
      sequential: true,
      order: 'post',
      handler() {
        const path = 'dist/sw.js';
        const sw = readFileSync(path, 'utf8');
        const marker = 'precacheAndRoute(';
        const start = sw.indexOf(marker);
        const arrStart = sw.indexOf('[', start);
        if (start < 0 || arrStart < 0) throw new Error('Swingframe service worker has no precache list');
        let depth = 0;
        let arrEnd = -1;
        for (let i = arrStart; i < sw.length; i++) {
          if (sw[i] === '[') depth++;
          else if (sw[i] === ']') {
            depth--;
            if (depth === 0) {
              arrEnd = i;
              break;
            }
          }
        }
        if (arrEnd < 0) throw new Error('Swingframe service worker precache list did not end');
        const entries: { url: string; revision: string | null }[] = [];
        const entryRe = /\{url:"([^"]+)",revision:(null|"[^"]*")\}/g;
        for (const match of sw.slice(arrStart, arrEnd + 1).matchAll(entryRe)) {
          const revision = match[2] === 'null' ? null : match[2].slice(1, -1);
          entries.push({ url: match[1], revision });
        }
        if (entries.length === 0) throw new Error('Swingframe service worker precache list could not be read');
        const kept = entries.filter((entry) => entry.url.startsWith(BASE));
        const dropped = entries.filter((entry) => !entry.url.startsWith(BASE));
        for (const entry of dropped) {
          const twin = `${BASE}${entry.url.replace(/^\//, '')}`;
          if (!kept.some((item) => item.url === twin)) {
            throw new Error(`Refusing to drop uncached ${entry.url}`);
          }
        }
        if (kept.length === 0) throw new Error('Swingframe precache list is empty');
        writeFileSync(path, sw.slice(0, arrStart) + JSON.stringify(kept) + sw.slice(arrEnd + 1));
      },
    },
  };
}

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      scope: BASE,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'icons/*.png'],
      // Icon srcs already include BASE; don't treat them as public/-relative files.
      includeManifestIcons: false,
      manifest: {
        id: BASE,
        name: 'Swingframe',
        short_name: 'Swingframe',
        description: 'Frame-by-frame golf swing video analysis, stored on this phone.',
        theme_color: '#101612',
        background_color: '#101612',
        display: 'standalone',
        orientation: 'any',
        start_url: BASE,
        scope: BASE,
        lang: 'en',
        categories: ['sports', 'utilities'],
        icons: [
          {
            src: `${BASE}icons/icon-192.png`,
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: `${BASE}icons/icon-512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: `${BASE}icons/icon-512-maskable.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        cacheId: 'swingframe',
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        // Precache URLs from the build are root-relative. Prefix them so the
        // worker only caches this app, not the github.io origin root.
        modifyURLPrefix: {
          '': BASE,
        },
        navigateFallback: `${BASE}index.html`,
        navigateFallbackAllowlist: [/^\/swingframe\/?/],
        directoryIndex: 'index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
      // Icons are already in /public. Don't regenerate them from the favicon.
      pwaAssets: {
        disabled: true,
      },
      devOptions: {
        enabled: false,
      },
    }),
    precacheOnlyUnderBase(),
  ],
  build: {
    target: 'es2022',
  },
  server: {
    host: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
