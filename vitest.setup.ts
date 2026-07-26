export {};

/**
 * Shared test setup.
 *
 * The DOM matchers are loaded only when a file has opted into a browser
 * environment. `setupFiles` runs for every test file, and importing jest-dom
 * under the default node environment throws — it reaches for `document` at
 * module scope.
 */
if (typeof window !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');

  const { cleanup } = await import('@testing-library/react');
  const { afterEach } = await import('vitest');
  // Testing Library only auto-cleans when a global `afterEach` is exposed, and
  // this project does not enable vitest globals.
  afterEach(cleanup);
}
