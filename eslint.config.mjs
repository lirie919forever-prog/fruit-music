import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      '@next/next/no-img-element': 'off',
    },
  },
  {
    files: ['**/*.cjs'],
    rules: {
      // Electron intentionally uses CommonJS because its package entrypoint is
      // loaded by Node directly. Requiring modules here is not renderer code.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    '.chrome-profile/**',
    '.edge-profile/**',
    '.edge-profile-2/**',
    '.edge-profile-3/**',
    'output/**',
  ]),
]);

export default eslintConfig;
