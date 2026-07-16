import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './[...path]/route';

function request(path: string, headers?: HeadersInit): NextRequest {
  return new NextRequest(`http://localhost/api/music/${path}`, { headers });
}

function context(path: string[]) {
  return { params: Promise.resolve({ path }) };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  delete process.env.JAMENDO_CLIENT_ID;
  delete process.env.JAMENDO_CLIENT_SECRET;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.JAMENDO_CLIENT_ID;
  delete process.env.JAMENDO_CLIENT_SECRET;
});

describe('music media proxy', () => {
  it.each([200, 206, 416])('preserves upstream status %s and streams its body', async status => {
    const upstreamHeaders = new Headers({
      'content-type': 'audio/mpeg',
      'content-length': status === 416 ? '0' : '4',
      ...(status === 206 ? { 'content-range': 'bytes 2-5/10', 'accept-ranges': 'bytes' } : {}),
      'x-upstream-only': 'hidden',
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ files: [{ name: 'song.mp3', format: 'VBR MP3', length: 10, size: 100 }] }))
      .mockResolvedValueOnce(new Response(status === 416 ? null : 'data', { status, headers: upstreamHeaders }));

    const response = await GET(
      request('archive/stream/item', { range: 'bytes=2-5', 'if-range': '"etag"' }),
      context(['archive', 'stream', 'item']),
    );

    expect(response.status).toBe(status);
    if (status !== 416) expect(response.body).toBeTruthy();
    expect(response.headers.get('content-type')).toBe('audio/mpeg');
    expect(response.headers.get('x-upstream-only')).toBeNull();
    if (status === 206) expect(response.headers.get('content-range')).toBe('bytes 2-5/10');

    const streamCall = vi.mocked(fetch).mock.calls[1];
    const forwarded = new Headers(streamCall[1]?.headers);
    expect(forwarded.get('range')).toBe('bytes=2-5');
    expect(forwarded.get('if-range')).toBe('"etag"');
    expect(streamCall[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toContain('Range');
  });

  it('does not advertise range support unless the upstream does', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ files: [{ name: 'song.mp3', format: 'VBR MP3', length: 10, size: 100 }] }))
      .mockResolvedValueOnce(new Response('audio', {
        status: 200,
        headers: { 'content-type': 'audio/mpeg', 'content-length': '5' },
      }));

    const response = await GET(
      request('archive/stream/item'),
      context(['archive', 'stream', 'item']),
    );

    expect(response.headers.get('accept-ranges')).toBeNull();
    expect(response.headers.get('content-range')).toBeNull();
    expect(response.headers.get('content-length')).toBe('5');
  });

  it('keeps Jamendo credentials server-controlled', async () => {
    process.env.JAMENDO_CLIENT_ID = 'configured-client';
    process.env.JAMENDO_CLIENT_SECRET = 'must-not-be-sent';
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      headers: { status: 'success', next: 'https://api.jamendo.com/v3.0/tracks?client_id=configured-client' },
      results: [],
    }));

    const response = await GET(
      request('jamendo/tracks?client_id=attacker&format=xml&limit=10'),
      context(['jamendo', 'tracks']),
    );

    expect(response.status).toBe(200);
    const upstreamUrl = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
    expect(upstreamUrl.origin).toBe('https://api.jamendo.com');
    expect(upstreamUrl.searchParams.get('client_id')).toBe('configured-client');
    expect(upstreamUrl.searchParams.get('format')).toBe('json');
    expect(upstreamUrl.searchParams.get('limit')).toBe('10');
    expect(upstreamUrl.toString()).not.toContain('must-not-be-sent');
    const body = await response.json() as { headers?: { next?: string } };
    expect(body.headers?.next).toBeUndefined();
  });

  it('preserves Jamendo application-level failures', async () => {
    process.env.JAMENDO_CLIENT_ID = 'configured-client';
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      headers: { status: 'failed', error_message: 'Invalid credentials' },
    }));

    const response = await GET(
      request('jamendo/tracks'),
      context(['jamendo', 'tracks']),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid credentials' });
  });

  it('rejects invalid Jamendo stream IDs before fetching', async () => {
    process.env.JAMENDO_CLIENT_ID = 'configured-client';

    const response = await GET(
      request('jamendo/stream/not-a-number'),
      context(['jamendo', 'stream', 'not-a-number']),
    );

    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns an honest configuration failure when Jamendo is not configured', async () => {
    const response = await GET(
      request('jamendo/tracks'),
      context(['jamendo', 'tracks']),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('not configured') });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects invalid provider IDs and out-of-range limits before fetching', async () => {
    const invalidId = await GET(
      request('ccmixter/stream/not-a-number'),
      context(['ccmixter', 'stream', 'not-a-number']),
    );
    expect(invalidId.status).toBe(400);

    const invalidLimit = await GET(
      request('archive/tracks?limit=101'),
      context(['archive', 'tracks']),
    );
    expect(invalidLimit.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves the ccMixter 25-result cap', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json([]));

    const response = await GET(
      request('ccmixter/tracks?limit=500'),
      context(['ccmixter', 'tracks']),
    );

    expect(response.status).toBe(200);
    const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
    expect(url.searchParams.get('limit')).toBe('25');
  });

  it('refuses a ccMixter upload without an MP3 file', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json([{
      files: [{ download_url: 'https://example.com/notes.txt', file_format_info: { mime_type: 'text/plain' } }],
    }]));

    const response = await GET(
      request('ccmixter/stream/123'),
      context(['ccmixter', 'stream', '123']),
    );

    expect(response.status).toBe(404);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('uses the verified ccMixter MP3 instead of the first arbitrary file', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json([{
        files: [
          { download_url: 'https://example.com/notes.txt', file_format_info: { mime_type: 'text/plain' } },
          { download_url: 'https://ccmixter.org/content/artist/song.mp3', file_format_info: { mime_type: 'audio/mpeg' } },
        ],
      }]))
      .mockResolvedValueOnce(new Response('music', {
        status: 206,
        headers: { 'content-type': 'audio/mpeg', 'content-range': 'bytes 0-4/10' },
      }));

    const response = await GET(
      request('ccmixter/stream/123', { range: 'bytes=0-4' }),
      context(['ccmixter', 'stream', '123']),
    );

    expect(response.status).toBe(206);
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toBe('https://ccmixter.org/content/artist/song.mp3');
    expect(vi.mocked(fetch).mock.calls[1][1]?.redirect).toBe('manual');
    expect(response.headers.get('content-range')).toBe('bytes 0-4/10');
  });

  it('rejects ccMixter media URLs outside approved hosts', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json([{
      files: [{ download_url: 'https://example.com/song.mp3', file_format_info: { mime_type: 'audio/mpeg' } }],
    }]));

    const response = await GET(
      request('ccmixter/stream/123'),
      context(['ccmixter', 'stream', '123']),
    );

    expect(response.status).toBe(502);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('uses Archive metadata files directly without probing the full media URL', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({
        files: [
          { name: 'notes.txt', format: 'Text' },
          { name: 'actual track.mp3', format: 'VBR MP3', length: '00:03:12', size: 12345 },
        ],
      }))
      .mockResolvedValueOnce(new Response('music', {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      }));

    const response = await GET(
      request('archive/stream/valid-item_1'),
      context(['archive', 'stream', 'valid-item_1']),
    );

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe('https://archive.org/metadata/valid-item_1');
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toBe(
      'https://archive.org/download/valid-item_1/actual%20track.mp3',
    );
  });

  it('returns 404 when Archive metadata has no MP3', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      files: [{ name: 'notes.txt', format: 'Text' }],
    }));

    const response = await GET(
      request('archive/stream/valid-item_1'),
      context(['archive', 'stream', 'valid-item_1']),
    );

    expect(response.status).toBe(404);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('queries Archive artists by creator instead of subject', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ response: { docs: [] } }));

    const response = await GET(
      request('archive/tracks?creator=Example%20Artist&limit=20'),
      context(['archive', 'tracks']),
    );

    expect(response.status).toBe(200);
    const upstreamUrl = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
    const query = upstreamUrl.searchParams.get('q') || '';
    expect(query).toContain('creator:(Example Artist)');
    expect(query).not.toContain('subject:(Example Artist)');
  });

  it('requires a playable Archive file with positive length and size', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      files: [
        { name: 'zero-length.mp3', format: 'VBR MP3', length: 0, size: 100 },
        { name: 'zero-size.mp3', format: 'VBR MP3', length: 0, size: 0 },
      ],
    }));

    const response = await GET(
      request('archive/stream/item'),
      context(['archive', 'stream', 'item']),
    );

    expect(response.status).toBe(404);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('binds an Archive stream to the exact requested playable file', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({
        files: [
          { name: 'track.mp3', format: 'VBR MP3', length: 10, size: 100 },
          { name: 'other.mp3', format: 'VBR MP3', length: 10, size: 100 },
        ],
      }))
      .mockResolvedValueOnce(new Response('music', { status: 206, headers: {
        'content-type': 'audio/mpeg', 'content-range': 'bytes 0-4/10',
      } }));

    const response = await GET(
      request('archive/stream/item?file=track.mp3', { range: 'bytes=0-4' }),
      context(['archive', 'stream', 'item']),
    );

    expect(response.status).toBe(206);
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toBe(
      'https://archive.org/download/item/track.mp3',
    );
    expect(vi.mocked(fetch).mock.calls[1][1]?.headers).toEqual(new Headers({ range: 'bytes=0-4' }));
  });

  it('enriches Archive catalog records and omits spoken-word records', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ response: { docs: [
        { identifier: 'music-item', title: 'Catalog title', creator: 'Catalog creator', licenseurl: 'http://creativecommons.org/licenses/by/4.0/' },
        { identifier: 'spoken-item', title: 'An audiobook lecture', creator: 'Reader', licenseurl: 'https://creativecommons.org/licenses/by/4.0/' },
      ] } }))
      .mockResolvedValueOnce(Response.json({
        metadata: {
          title: 'Verified song', creator: 'Verified artist', subject: ['jazz'], year: 2024,
          licenseurl: 'http://creativecommons.org/licenses/by-sa/4.0/',
        },
        files: [{ name: 'verified.mp3', format: 'VBR MP3', length: '01:02', size: 2048, bitrate: 192 }],
      }))
      .mockResolvedValueOnce(Response.json({
        metadata: {
          title: 'Audiobook lecture', creator: 'Reader', licenseurl: 'https://creativecommons.org/licenses/by/4.0/',
        },
        files: [{ name: 'spoken.mp3', format: 'VBR MP3', length: 100, size: 2048 }],
      }));

    const response = await GET(
      request('archive/tracks?creator=Example%20Artist&limit=10'),
      context(['archive', 'tracks']),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ results: [{
      identifier: 'music-item', title: 'Verified song', creator: 'Verified artist', subject: ['jazz'], year: '2024',
      filename: 'verified.mp3', duration: 62, size: 2048, bitRate: 192, contentType: 'audio/mpeg', suffix: 'mp3',
      streamUrl: '/api/music/archive/stream/music-item?file=verified.mp3',
      sourceUrl: 'https://archive.org/details/music-item', creatorUrl: '',
      licenseName: 'CC BY-SA', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      attributionUrl: 'https://archive.org/details/music-item',
    }] });
  });

  it('preserves provider HTTP failures rather than returning a successful empty payload', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('unavailable', { status: 503 }));

    const response = await GET(
      request('archive/tracks'),
      context(['archive', 'tracks']),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: 'Archive upstream error' });
  });
});
