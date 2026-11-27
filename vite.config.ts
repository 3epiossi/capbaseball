import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { defineConfig, type Plugin } from 'vite';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

const now = new Date();
const pad = (n: number) => String(n).padStart(2, '0');
const BUILD = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

const versionPlugin: Plugin = {
  name: 'version',
  apply: 'build',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'version.json',
      source: JSON.stringify({ build: BUILD }),
    });
  },
  closeBundle() {
    const allFiles = (readdirSync('dist', { recursive: true }) as string[]).map((f) => f.replace(/\\/g, '/'));
    const precacheSet = new Set<string>(['./', './index.html', './pitch-lab.html', './field-lab.html']);
    for (const f of allFiles) {
      const p = `dist/${f}`;
      if (f.endsWith('.gz') || f === 'sw.js' || !statSync(p).isFile()) continue;
      precacheSet.add(`./${f}`);
    }
    const precacheList = JSON.stringify(Array.from(precacheSet));
    const swSource = `// Auto-generated Service Worker for Cap Baseball offline play (Build ${BUILD})
const CACHE_NAME = 'capbaseball-precache-${BUILD}';
const FONT_CACHE = 'capbaseball-fonts-v1';
const PRECACHE_URLS = ${precacheList};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // cache:'reload' skips the HTTP cache: Cloudflare adds max-age=14400 to sprites, which otherwise re-stores stale PNGs
      .then((cache) => cache.addAll(PRECACHE_URLS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('capbaseball-precache-') && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isLiveApiPath(pathname) {
  return (
    pathname.endsWith('/ws') ||
    pathname.endsWith('/health') ||
    pathname.endsWith('/metrics') ||
    pathname.endsWith('/monitor') ||
    pathname.endsWith('/monitor.js') ||
    pathname.endsWith('/analytics') ||
    pathname.endsWith('/analytics.js') ||
    pathname.endsWith('/analytics.json')
  );
}

async function fetchWithTimeout(request, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(request, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts: Cache-First so typography works offline
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(FONT_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        } catch {
          return hit || Response.error();
        }
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (isLiveApiPath(url.pathname)) return;

  const isNav =
    req.mode === 'navigate' ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('/index.html') ||
    url.pathname.endsWith('/pitch-lab') ||
    url.pathname.endsWith('/pitch-lab.html');

  if (isNav) {
    // Network-First with 3s timeout & 5xx Cloudflare fallback:
    // When server is online, always serve the latest HTML; when server is down (offline or 502/521/530),
    // fall back seamlessly to the cached game shell so all offline modes remain playable!
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const res = await fetchWithTimeout(req, 3000);
          if (res && res.ok) {
            cache.put(req, res.clone());
            return res;
          }
          // Server/Cloudflare returned 5xx (e.g. Raspberry Pi is powered off) -> fallback to cache
        } catch {
          // Network offline or timed out -> fallback to cache
        }
        const exact = await cache.match(req, { ignoreSearch: true });
        if (exact) return exact;
        const isPitchLab = url.pathname.includes('pitch-lab');
        const fallback = await cache.match(isPitchLab ? './pitch-lab.html' : './index.html', {
          ignoreSearch: true,
        });
        return fallback || (await cache.match('./', { ignoreSearch: true })) || Response.error();
      })()
    );
    return;
  }

  // Static assets & sprites: Cache-First with Network Fallback
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          cache.put(req, res.clone());
        }
        return res;
      } catch {
        return cached || Response.error();
      }
    })()
  );
});
`;
    writeFileSync('dist/sw.js', swSource, 'utf8');

    for (const f of readdirSync('dist', { recursive: true }) as string[]) {
      const p = `dist/${f}`;
      if (!/\.(js|css|html|json|svg|webmanifest)$/.test(f) || !statSync(p).isFile() || statSync(p).size < 1024) {
        continue;
      }
      const raw = readFileSync(p);
      const gz = gzipSync(raw, { level: 9 });
      if (gz.length < raw.length * 0.9) {
        writeFileSync(`${p}.gz`, gz);
      }
    }
  },
};

export default defineConfig({
  base: './',
  plugins: [versionPlugin],
  define: {
    __BUILD__: JSON.stringify(BUILD),
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(rootDir, 'index.html'),
        pitchLab: resolve(rootDir, 'pitch-lab.html'),
        fieldLab: resolve(rootDir, 'field-lab.html'),
      },
    },
  },
  server: {
    proxy: {
      '/ws': {
        target: 'ws://127.0.0.1:8788',
        ws: true,
      },
    },
  },
});
