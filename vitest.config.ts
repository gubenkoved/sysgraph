import { defineConfig } from 'vitest/config';

// unit tests for the frontend live alongside the modules they cover
// (src/sysgraph-ui/**/*.test.ts). parser/search tests need no DOM, so the
// default node environment is sufficient.
export default defineConfig({
  test: {
    include: ['src/sysgraph-ui/**/*.test.ts'],
    environment: 'node',
  },
});
