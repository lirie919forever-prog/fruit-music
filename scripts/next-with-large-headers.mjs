#!/usr/bin/env node
/**
 * Starts Next.js with a raised HTTP header size limit.
 *
 * ccMixter's API returns its JSON payload in an `X-JSON` response header rather
 * than the body, and that is the only response mode carrying file and license
 * data. The payload passes Node's default 16 KB header cap after only a handful
 * of records, so requests for a full page fail with UND_ERR_HEADERS_OVERFLOW.
 *
 * The limit has to reach the route handlers, which Next runs in child
 * processes, so it is set through NODE_OPTIONS rather than as a CLI flag on
 * this process. Doing it here keeps `npm run dev` and `npm start` portable
 * across shells instead of relying on POSIX-only inline environment syntax.
 *
 * The proxy still degrades gracefully without this flag: it retries with
 * smaller pages, trading extra round trips for a response that fits.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const HEADER_SIZE_BYTES = 1024 * 1024;
const FLAG = `--max-http-header-size=${HEADER_SIZE_BYTES}`;

const nodeOptions = [process.env.NODE_OPTIONS, FLAG].filter(Boolean).join(' ');
const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');

const child = spawn(process.execPath, [nextBin, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
