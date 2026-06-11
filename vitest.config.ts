import { defineConfig } from 'vitest/config';

// unit tests for the frontend live alongside the modules they cover
// (src/sysgraph-ui/**/*.test.ts). parser/search tests need no DOM, so the
// default node environment is sufficient.
export default defineConfig({
  test: {
    include: ['src/sysgraph-ui/**/*.test.ts'],
    environment: 'node',
  },
  // mirror the build-time globals injected by vite so modules that read them
  // (e.g. constants.ts → STANDALONE) load under the test runner
  define: {
    __STANDALONE__: false,
  },
});
