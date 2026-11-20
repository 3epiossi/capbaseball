import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { defineConfig, type Plugin } from 'vite';

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
    for (const f of readdirSync('dist', { recursive: true }) as string[]) {
      const p = `dist/${f}`;
      if (!/\.(js|css|html|json|svg)$/.test(f) || !statSync(p).isFile() || statSync(p).size < 1024) {
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
  server: {
    proxy: {
      '/ws': {
        target: 'ws://127.0.0.1:8788',
        ws: true,
      },
    },
  },
});
