import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * Read the package version from src/sysgraph/__init__.py (single source of truth).
 */
function readPythonVersion(): string {
  const initPy = readFileSync(
    resolve(__dirname, 'src/sysgraph/__init__.py'), 'utf-8',
  );
  const match = initPy.match(/__version__\s*=\s*["']([^"']+)["']/);
  if (!match) throw new Error('Could not parse __version__ from __init__.py');
  return match[1];
}

export default defineConfig({
  root: 'src/sysgraph-ui',
  publicDir: 'public',
  // Base public path. Defaults to '/' for local/backend-served builds.
  // For GitHub Pages set VITE_BASE (e.g. '/sysgraph/') at build time.
  base: process.env['VITE_BASE'] || '/',
  // Standalone mode: when enabled the UI never talks to the backend
  // (no /api/graph fetch, no "reload sysgraph" action). The user can still
  // explore graphs by importing JSON. Enable via VITE_STANDALONE=true|1.
  define: {
    __STANDALONE__: JSON.stringify(
      process.env['VITE_STANDALONE'] === 'true' ||
        process.env['VITE_STANDALONE'] === '1',
    ),
  },
  build: {
    outDir: resolve(__dirname, 'src/sysgraph/dist'),
    emptyOutDir: true,
  },
  plugins: [
    {
      name: 'inject-python-version',
      transformIndexHtml(html: string) {
        return html.replace('__APP_VERSION__', readPythonVersion());
      },
    },
  ],
  server: {
    proxy: {
      '/api': process.env['VITE_BACKEND_URL'] || 'http://localhost:8000',
    },
  },
});
