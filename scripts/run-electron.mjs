import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const electronPackage = require.resolve('electron/package.json');
const electronBinary = path.join(
  path.dirname(electronPackage),
  'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron',
);
const childEnvironment = { ...process.env };

// Some Windows development shells export this flag globally for Electron
// tooling. It changes electron.exe into Node mode, where the Electron `app`
// and `protocol` modules are unavailable.
delete childEnvironment.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, ['electron/main.cjs', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: false,
  cwd: process.cwd(),
  env: childEnvironment,
});

child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
