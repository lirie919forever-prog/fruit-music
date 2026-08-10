import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const electronPackage = require.resolve('electron/package.json');
const electronBinary = path.join(
  path.dirname(electronPackage),
  'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron',
);
const nextLauncher = new URL('./next-with-large-headers.mjs', import.meta.url);
const configuredUrl = process.env.MAREA_URL?.trim();
const port = process.env.MAREA_PORT?.trim() || '3011';
const rendererUrl = configuredUrl || `http://localhost:${port}`;
const nextEnvironment = { ...process.env };
delete nextEnvironment.ELECTRON_RUN_AS_NODE;

// Invoke Node directly instead of spawning npm.cmd. On Windows, npm.cmd with
// shell:false can fail with EINVAL before the development server starts.
// MAREA_URL also lets this launcher attach to an already-running dev server,
// which avoids competing for Next's single .next development lock.
const next = configuredUrl
  ? undefined
  : spawn(process.execPath, [fileURLToPath(nextLauncher), 'dev', '--port', port], {
      stdio: 'inherit',
      shell: false,
      cwd: process.cwd(),
      env: nextEnvironment,
    });
let desktop;
let stopped = false;

async function waitForNext() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await fetch(rendererUrl);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`Next dev server did not become ready at ${rendererUrl}`);
}

function stop() {
  if (stopped) return;
  stopped = true;
  desktop?.kill();
  next?.kill();
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
next?.on('error', (error) => {
  console.error(error);
  stop();
});

try {
  await waitForNext();
  desktop = spawn(electronBinary, ['electron/main.cjs'], {
    stdio: 'inherit',
    shell: false,
    env: nextEnvironment,
  });
  desktop.on('exit', (code) => {
    stop();
    process.exit(code ?? 0);
  });
} catch (error) {
  stop();
  console.error(error);
  process.exitCode = 1;
}
