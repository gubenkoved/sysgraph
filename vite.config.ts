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
