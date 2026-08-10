import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createLocalFileResponse, createMediaProtocolHandler } = require('./mediaProtocol.cjs');

const MEDIA_URL = 'marea-media://audio/local-desktop-7b9a7a63-f3cb-48c1-97c1-a7409af04c6b';

describe('desktop media protocol handler', () => {
  it('rejects unsafe methods and opaque URLs before touching the file fetcher', async () => {
    const resolveRecord = vi.fn();
    const fetchFile = vi.fn();
    const handler = createMediaProtocolHandler({ resolveRecord, fetchFile });

    expect((await handler(new Request(MEDIA_URL, { method: 'POST' }))).status).toBe(405);
    expect((await handler(new Request('marea-media://audio/C:/Music/track.mp3'))).status).toBe(404);
    expect(resolveRecord).not.toHaveBeenCalled();
    expect(fetchFile).not.toHaveBeenCalled();
  });

  it('resolves the capability and forwards GET range headers to the file fetcher', async () => {
    const resolveRecord = vi.fn(async () => ({ path: 'C:\\Music\\track.mp3' }));
    const fetchFile = vi.fn(
      async (_path, request) =>
        new Response('range-data', {
          status: 206,
          headers: { 'Content-Range': request.headers.get('range') ?? '' },
        }),
    );
    const handler = createMediaProtocolHandler({ resolveRecord, fetchFile });

    const response = await handler(new Request(MEDIA_URL, { headers: { Range: 'bytes=10-19' } }));

    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe('bytes=10-19');
    expect(await response.text()).toBe('range-data');
    expect(resolveRecord).toHaveBeenCalledWith('local-desktop-7b9a7a63-f3cb-48c1-97c1-a7409af04c6b');
    expect(fetchFile).toHaveBeenCalledWith('C:\\Music\\track.mp3', expect.any(Request));
  });

  it('returns 404 when a capability or its backing file cannot be resolved', async () => {
    const handler = createMediaProtocolHandler({
      resolveRecord: async () => {
        throw new Error('file disappeared');
      },
      fetchFile: vi.fn(),
    });

    expect((await handler(new Request(MEDIA_URL))).status).toBe(404);
  });

  it('streams full, ranged, and HEAD responses without buffering the file', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'marea-media-'));
    const filePath = path.join(directory, 'sample.mp3');
    await writeFile(filePath, '0123456789abcdef');

    try {
      const full = await createLocalFileResponse(filePath, new Request('http://localhost/audio'));
      expect(full.status).toBe(200);
      expect(full.headers.get('Content-Length')).toBe('16');
      expect(full.headers.get('Content-Type')).toBe('audio/mpeg');
      expect(await full.text()).toBe('0123456789abcdef');

      const ranged = await createLocalFileResponse(
        filePath,
        new Request('http://localhost/audio', { headers: { Range: 'bytes=2-5' } }),
      );
      expect(ranged.status).toBe(206);
      expect(ranged.headers.get('Content-Range')).toBe('bytes 2-5/16');
      expect(await ranged.text()).toBe('2345');

      const head = await createLocalFileResponse(
        filePath,
        new Request('http://localhost/audio', { method: 'HEAD', headers: { Range: 'bytes=2-5' } }),
      );
      expect(head.status).toBe(206);
      expect(head.headers.get('Content-Length')).toBe('4');
      expect(head.body).toBeNull();

      const invalid = await createLocalFileResponse(
        filePath,
        new Request('http://localhost/audio', { headers: { Range: 'bytes=99-100' } }),
      );
      expect(invalid.status).toBe(416);
      expect(invalid.headers.get('Content-Range')).toBe('bytes */16');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
