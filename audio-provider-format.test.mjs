import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./src/components/player/AudioProvider.tsx', import.meta.url), 'utf8');

test('AudioProvider derives format from verified song metadata', () => {
  assert.match(
    source,
    /format:\s*\[getHowlerFormat\(song\)\]/,
    'Expected Howl options to derive format from the selected song metadata'
  );

  assert.match(source, /contentType === 'audio\/mpeg'/);
  assert.match(source, /suffix === 'ogg'/);
});
