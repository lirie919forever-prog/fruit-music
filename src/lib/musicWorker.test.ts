import { describe, expect, it } from 'vitest';
import { parseId3MetadataBuffer, parseLrcInWorker, readId3Metadata } from './musicWorker';

describe('music worker client', () => {
  it('falls back to the tested parser when workers are unavailable', async () => {
    await expect(parseLrcInWorker('[00:01.00] one\n[00:02.00] two')).resolves.toEqual([
      { time: 1, text: 'one' },
      { time: 2, text: 'two' },
    ]);
  });

  it('keeps metadata import resilient when workers are unavailable', async () => {
    await expect(readId3Metadata(new Blob(['not id3']))).resolves.toEqual({});
  });

  it('parses a bounded desktop metadata header without reading a full track', async () => {
    await expect(parseId3MetadataBuffer(new TextEncoder().encode('not id3').buffer)).resolves.toEqual({});
  });
});
