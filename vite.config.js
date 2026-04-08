import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync } from 'fs';

/**
 * Read the package version from src/procmap/__init__.py (single source of truth).
 */
function readPythonVersion() {
  const initPy = readFileSync(
    resolve(__dirname, 'src/procmap/__init__.py'), 'utf-8',
  );
  const match = initPy.match(/__version__\s*=\s*["']([^"']+)["']/);
  if (!match) throw new Error('Could not parse __version__ from __init__.py');
  return match[1];
}

/**
 * Simple recursive copy (avoids pulling in a Vite plugin for one task).
 */
function copyDirSync(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = resolve(src, entry);
    const destPath = resolve(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

/** Copy Shoelace icon assets into public/ so they are available at /shoelace/assets/icons */
function copyShoelaceAssets() {
  return {
    name: 'copy-shoelace-assets',
    buildStart() {
      const src = resolve(__dirname, 'node_modules/@shoelace-style/shoelace/dist/assets');
      const dest = resolve(__dirname, 'src/procmap-ui/public/shoelace/assets');
      copyDirSync(src, dest);
    },
  };
}

export default defineConfig({
  root: 'src/procmap-ui',
  publicDir: 'public',
  build: {
    outDir: resolve(__dirname, 'src/procmap/dist'),
    emptyOutDir: true,
  },
  plugins: [
    copyShoelaceAssets(),
    {
      name: 'inject-python-version',
      transformIndexHtml(html) {
        return html.replace('__APP_VERSION__', readPythonVersion());
      },
    },
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
});
