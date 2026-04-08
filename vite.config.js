import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'fs';

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
  plugins: [copyShoelaceAssets()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
});
