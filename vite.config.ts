import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readdirSync, readFileSync } from 'fs';
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

interface ExampleInfo {
  file: string;
  title: string;
  nodes: number;
  edges: number;
}

/**
 * Derive a human-readable title from an example filename
 * (e.g. 'greek-mythology.json' -> 'Greek Mythology'). Used as a fallback when
 * the graph JSON does not provide an explicit `title`.
 */
function titleFromFilename(name: string): string {
  return name
    .replace(/\.json$/, '')
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Read the built-in example graphs from the top-level `data/` directory.
 * Returns a manifest (used by the UI to know what's available) and the raw
 * JSON contents keyed by filename. Invalid or unreadable files are skipped.
 */
function readExamples(): { manifest: ExampleInfo[]; files: Map<string, string> } {
  const dataDir = resolve(__dirname, 'data');
  const files = new Map<string, string>();
  const manifest: ExampleInfo[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dataDir);
  } catch {
    return { manifest, files };
  }

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    let raw: string;
    try {
      raw = readFileSync(resolve(dataDir, entry), 'utf-8');
    } catch {
      continue;
    }
    let nodes = 0;
    let edges = 0;
    let title = titleFromFilename(entry);
    try {
      const data = JSON.parse(raw) as Record<string, unknown>;
      const rawNodes = data.nodes;
      const rawEdges = data.edges ?? data.relationships ?? data.links;
      nodes = Array.isArray(rawNodes)
        ? rawNodes.length
        : rawNodes ? Object.keys(rawNodes).length : 0;
      edges = Array.isArray(rawEdges)
        ? rawEdges.length
        : rawEdges ? Object.keys(rawEdges).length : 0;
      // an explicit `title` in the graph JSON wins over the filename-derived
      // one (lets examples control exact casing, e.g. "US Airports")
      if (typeof data.title === 'string' && data.title.trim()) {
        title = data.title.trim();
      }
    } catch {
      // Skip files that are not valid JSON graphs.
      continue;
    }
    files.set(entry, raw);
    manifest.push({ file: entry, title, nodes, edges });
  }

  // order by composite size (nodes + edges), then title for stable ties
  manifest.sort(
    (a, b) =>
      a.nodes + a.edges - (b.nodes + b.edges) ||
      a.title.localeCompare(b.title),
  );
  return { manifest, files };
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
        return html.replaceAll('__APP_VERSION__', readPythonVersion());
      },
    },
    {
      // Bundle the top-level data/*.json graphs into dist/examples/ as static
      // assets, plus an examples/index.json manifest the UI uses to discover
      // them. Keeping this fully static means it works in backend-served,
      // standalone, and GitHub Pages builds with no extra packaging.
      name: 'bundle-examples',
      generateBundle() {
        const { manifest, files } = readExamples();
        for (const [name, raw] of files) {
          this.emitFile({
            type: 'asset',
            fileName: `examples/${name}`,
            source: raw,
          });
        }
        this.emitFile({
          type: 'asset',
          fileName: 'examples/index.json',
          source: JSON.stringify(manifest, null, 2),
        });
      },
      configureServer(server) {
        // Serve the same examples from data/ in the dev server.
        server.middlewares.use((req, res, next) => {
          const match = (req.url ?? '').match(/\/examples\/([^/?#]+)$/);
          if (!match) return next();
          const { manifest, files } = readExamples();
          const name = decodeURIComponent(match[1]);
          res.setHeader('Content-Type', 'application/json');
          if (name === 'index.json') {
            res.end(JSON.stringify(manifest, null, 2));
            return;
          }
          const raw = files.get(name);
          if (raw == null) return next();
          res.end(raw);
        });
      },
    },
  ],
  server: {
    proxy: {
      '/api': process.env['VITE_BACKEND_URL'] || 'http://localhost:8000',
    },
  },
});
