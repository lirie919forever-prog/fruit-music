import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'electron/**/*.test.mjs'],
    setupFiles: ['./vitest.setup.ts'],
    // Node stays the default; browser tests opt in per file with an
    // `@vitest-environment happy-dom` docblock.
    //
    // Most suites here are route handlers exercising `Request`, `Response` and
    // `fetch` directly. Running those under a DOM environment swaps in its own
    // implementations of exactly those globals, so the tests would stop
    // measuring the runtime the routes actually run on — and every one of them
    // would pay for a DOM it never touches.
    environment: 'node',
  },
});
