import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// GitHub Pages project site. Other sites on this account share the github.io
// origin, so the app, its service worker, and its caches stay under this path.
const BASE = '/swingframe/';

// OCR runs on the phone. Copy the worker, the SIMD core, and the English
// traineddata next to the app so nothing is fetched from a CDN at runtime.
function stageTesseract() {
  const root = resolve('public/tesseract');
  rmSync(root, { recursive: true, force: true });
  mkdirSync(resolve(root, 'lang'), { recursive: true });
  cpSync(resolve('node_modules/tesseract.js/dist/worker.min.js'), resolve(root, 'worker.min.js'));
  cpSync(
    resolve('node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js'),
    resolve(root, 'tesseract-core-simd-lstm.wasm.js'),
  );
  cpSync(
    resolve('node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'),
    resolve(root, 'lang/eng.traineddata.gz'),
  );
}

stageTesseract();

// Pose runs on the phone. Copy the vision runtime and the lite landmark model
// next to the app so foot detection never fetches a CDN.
function stagePose() {
  const root = resolve('public/pose');
  rmSync(root, { recursive: true, force: true });
  const wasmOut = resolve(root, 'wasm');
  mkdirSync(wasmOut, { recursive: true });
  const wasmDir = resolve('node_modules/@mediapipe/tasks-vision/wasm');
  for (const name of [
    'vision_wasm_internal.js',
    'vision_wasm_internal.wasm',
    'vision_wasm_nosimd_internal.js',
    'vision_wasm_nosimd_internal.wasm',
  ]) {
    cpSync(resolve(wasmDir, name), resolve(wasmOut, name));
  }
  cpSync(resolve('vendor/pose/pose_landmarker_lite.task'), resolve(root, 'pose_landmarker_lite.task'));
}

stagePose();

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
        const scoped = entries.filter((entry) => entry.url.startsWith(BASE));
        const kept = scoped.filter((entry) => !entry.url.endsWith('/index.html') && !entry.url.endsWith('/sw.js'));
        const dropped = entries.filter((entry) => !entry.url.startsWith(BASE));
        for (const entry of dropped) {
          const twin = `${BASE}${entry.url.replace(/^\//, '')}`;
          if (!kept.some((item) => item.url === twin)) {
            throw new Error(`Refusing to drop uncached ${entry.url}`);
          }
        }
        if (kept.length === 0) throw new Error('Swingframe precache list is empty');
        // Tell open pages a new worker is in control. Do not client.navigate()
        // here: that navigation is fetched by this worker, and Chrome will not
        // finish it until activate's waitUntil resolves, so awaiting it hangs
        // the page. The page reloads itself, once, on this message.
        const refresh = `
self.addEventListener('install',function(){self.skipWaiting();});
self.addEventListener('activate',function(event){event.waitUntil((async function(){
await self.clients.claim();
var list=await self.clients.matchAll({type:'window',includeUncontrolled:true});
for(var i=0;i<list.length;i++){
try{list[i].postMessage({type:'swingframe-updated'})}catch(e){}
}
})());});
self.addEventListener('message',function(event){
if(event.data&&event.data.type==='SKIP_WAITING')self.skipWaiting();
});
`;
        writeFileSync(path, sw.slice(0, arrStart) + JSON.stringify(kept) + sw.slice(arrEnd + 1) + refresh);
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
      injectRegister: false,
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
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,jpeg,ico,webmanifest,gz,wasm,task}'],
        maximumFileSizeToCacheInBytes: 16 * 1024 * 1024,
        // Precache URLs from the build are root-relative. Prefix them so the
        // worker only caches this app, not the github.io origin root.
        modifyURLPrefix: {
          '': BASE,
        },
        navigateFallback: null,
        directoryIndex: null,
        globIgnores: ['**/node_modules/**/*', '**/sw.js', '**/workbox-*.js', '**/registerSW.js'],
        manifestTransforms: [
          (entries) => ({
            manifest: entries.filter((entry) => {
              const url = typeof entry === 'string' ? entry : entry.url;
              return url !== 'index.html' && !url.endsWith('/index.html') && !url.endsWith('/sw.js') && url !== 'sw.js' && !url.endsWith('/registerSW.js');
            }),
            warnings: [],
          }),
        ],
        runtimeCaching: [
          {
            urlPattern: /\/swingframe\/sw\.js$/,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: ({ request, url }: { request: Request; url: URL }) =>
              request.mode === 'navigate' ||
              url.pathname === '/swingframe/' ||
              url.pathname === '/swingframe/index.html',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'swingframe-pages',
              networkTimeoutSeconds: 4,
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
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
