import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './[...path]/route';

function request(path: string, headers?: HeadersInit): NextRequest {
  return new NextRequest(`http://localhost/api/music/${path}`, { headers });
}

function context(path: string[]) {
  return { params: Promise.resolve({ path }) };
}

// Workers already in flight when the limit is reached still finish their own
// candidate, so allow one extra lookup per concurrent worker.
const ARCHIVE_ENRICHMENT_SLACK = 4;

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
  it.each([200, 206, 416])('preserves upstream status %s and streams its body', async (status) => {
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
    if (status === 206) {
      expect(response.headers.get('vercel-cdn-cache-control')).toBeNull();
      expect(response.headers.get('cdn-cache-control')).toBeNull();
    }
    expect(response.headers.get('vary')).toContain('Range');
  });

  it('aborts the upstream body when the downstream cancels a stream', async () => {
    let upstreamSignal: AbortSignal | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ files: [{ name: 'song.mp3', format: 'VBR MP3', length: 10, size: 100 }] }))
      .mockImplementationOnce(async (_url, init) => {
        upstreamSignal = init?.signal as AbortSignal;
        return new Response(body, { status: 200, headers: { 'content-type': 'audio/mpeg' } });
      });

    const response = await GET(request('archive/stream/item'), context(['archive', 'stream', 'item']));
    expect(upstreamSignal?.aborted).toBe(false);
    await response.body?.cancel('client disconnected');
    expect(upstreamSignal?.aborted).toBe(true);
  });

  it('caches successful catalog and full-stream responses at the CDN', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json([{ upload_id: 1 }]))
      .mockResolvedValueOnce(Response.json({ files: [{ name: 'song.mp3', format: 'VBR MP3', length: 10, size: 100 }] }))
      .mockResolvedValueOnce(new Response('audio', { status: 200, headers: { 'content-type': 'audio/mpeg' } }));

    const catalog = await GET(request('ccmixter/tracks'), context(['ccmixter', 'tracks']));
    const stream = await GET(request('archive/stream/item'), context(['archive', 'stream', 'item']));

    for (const response of [catalog, stream]) {
      expect(response.headers.get('cache-control')).toContain('s-maxage=');
      expect(response.headers.get('vercel-cdn-cache-control')).toBe(response.headers.get('cache-control'));
      expect(response.headers.get('cdn-cache-control')).toBe(response.headers.get('cache-control'));
    }
  });

  it('rejects successful upstream streams without an audio MIME type', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ files: [{ name: 'song.mp3', format: 'VBR MP3', length: 10, size: 100 }] }))
      .mockResolvedValueOnce(new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }));

    const response = await GET(request('archive/stream/item'), context(['archive', 'stream', 'item']));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: 'Upstream returned invalid media' });
  });

  it('follows validated ccMixter redirects and preserves range headers', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json([
          { files: [{ download_url: 'https://ccmixter.org/song.mp3', file_format_info: { mime_type: 'audio/mpeg' } }] },
        ]),
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'https://www.ccmixter.org/song.mp3' } }),
      )
      .mockResolvedValueOnce(
        new Response('music', {
          status: 206,
          headers: { 'content-type': 'audio/mpeg', 'content-range': 'bytes 0-4/10' },
        }),
      );

    const response = await GET(
      request('ccmixter/stream/123', { range: 'bytes=0-4', 'if-range': '"etag"' }),
      context(['ccmixter', 'stream', '123']),
    );

    expect(response.status).toBe(206);
    expect(String(vi.mocked(fetch).mock.calls[2][0])).toBe('https://www.ccmixter.org/song.mp3');
    expect(new Headers(vi.mocked(fetch).mock.calls[2][1]?.headers).get('range')).toBe('bytes=0-4');
    expect(new Headers(vi.mocked(fetch).mock.calls[2][1]?.headers).get('if-range')).toBe('"etag"');
  });

  it('sends the referer ccMixter media requires and never forwards a browser one', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json([
          {
            files: [{ download_url: 'https://ccmixter.org/song.mp3', file_format_info: { mime_type: 'audio/mpeg' } }],
          },
        ]),
      )
      .mockResolvedValueOnce(new Response('music', { status: 200, headers: { 'content-type': 'audio/mpeg' } }));

    const response = await GET(
      request('ccmixter/stream/123', { referer: 'https://attacker.example/', range: 'bytes=0-9' }),
      context(['ccmixter', 'stream', '123']),
    );

    expect(response.status).toBe(200);
    const sent = new Headers(vi.mocked(fetch).mock.calls[1][1]?.headers);
    expect(sent.get('referer')).toBe('https://ccmixter.org/');
    expect(sent.get('range')).toBe('bytes=0-9');
  });

  it('rejects external ccMixter redirect targets and redirect exhaustion', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json([
          { files: [{ download_url: 'https://ccmixter.org/song.mp3', file_format_info: { mime_type: 'audio/mpeg' } }] },
        ]),
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'https://example.com/song.mp3' } }),
      );
    const external = await GET(request('ccmixter/stream/123'), context(['ccmixter', 'stream', '123']));
    expect(external.status).toBe(502);

    // A chain that revisits a URL is cut as soon as the repeat is seen rather
    // than fetched until the redirect budget runs out.
    vi.mocked(fetch)
      .mockReset()
      .mockResolvedValueOnce(
        Response.json([
          { files: [{ download_url: 'https://ccmixter.org/song.mp3', file_format_info: { mime_type: 'audio/mpeg' } }] },
        ]),
      )
      .mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://ccmixter.org/next.mp3' } }));
    const looping = await GET(request('ccmixter/stream/123'), context(['ccmixter', 'stream', '123']));
    expect(looping.status).toBe(502);
    expect(await looping.text()).toBe('Stream redirect loop');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('stops after the redirect budget even when every hop is a new approved URL', async () => {
    let hop = 0;
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json([
          { files: [{ download_url: 'https://ccmixter.org/song.mp3', file_format_info: { mime_type: 'audio/mpeg' } }] },
        ]),
      )
      .mockImplementation(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: `https://ccmixter.org/hop-${hop++}.mp3` },
          }),
      );

    const response = await GET(request('ccmixter/stream/123'), context(['ccmixter', 'stream', '123']));

    expect(response.status).toBe(502);
    expect(await response.text()).toBe('Too many stream redirects');
    // One metadata lookup, then the start URL plus three redirects.
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it('refuses to follow a redirect off the provider on every stream path', async () => {
    // The off-site target answers with perfectly good audio. Following it would
    // therefore return 200 and stream an attacker-chosen body through our own
    // origin — which is exactly what jamendo, archive and itunes did before,
    // because they passed no redirect validator at all.
    const offsiteThenAudio = (prelude: Response[]) => {
      const queue = [
        ...prelude,
        new Response(null, {
          status: 302,
          headers: { location: 'https://attacker.example/song.mp3' },
        }),
      ];
      return vi
        .mocked(fetch)
        .mockReset()
        .mockImplementation(
          async () =>
            queue.shift() ?? new Response('audio-bytes', { status: 200, headers: { 'content-type': 'audio/mpeg' } }),
        );
    };

    process.env.JAMENDO_CLIENT_ID = 'test-id';
    offsiteThenAudio([]);
    const jamendo = await GET(request('jamendo/stream/9'), context(['jamendo', 'stream', '9']));
    expect(jamendo.status).toBe(502);

    offsiteThenAudio([Response.json({ files: [{ name: 'a.mp3', format: 'VBR MP3', length: '30', size: '1000' }] })]);
    const archive = await GET(request('archive/stream/item'), context(['archive', 'stream', 'item']));
    expect(archive.status).toBe(502);

    offsiteThenAudio([
      Response.json({ results: [{ trackId: 5, previewUrl: 'https://audio-ssl.itunes.apple.com/p.m4a' }] }),
    ]);
    const itunes = await GET(request('itunes/stream/5'), context(['itunes', 'stream', '5']));
    expect(itunes.status).toBe(502);
  });

  it('rejects a malformed partial response and cancels its body', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ files: [{ name: 'song.mp3', format: 'VBR MP3', length: 10, size: 100 }] }))
      .mockResolvedValueOnce(new Response(body, { status: 206, headers: { 'content-type': 'audio/mpeg' } }));

    const response = await GET(request('archive/stream/item'), context(['archive', 'stream', 'item']));

    expect(response.status).toBe(502);
    expect(cancelled).toBe(true);
  });

  it('does not advertise range support unless the upstream does', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ files: [{ name: 'song.mp3', format: 'VBR MP3', length: 10, size: 100 }] }))
      .mockResolvedValueOnce(
        new Response('audio', {
          status: 200,
          headers: { 'content-type': 'audio/mpeg', 'content-length': '5' },
        }),
      );

    const response = await GET(request('archive/stream/item'), context(['archive', 'stream', 'item']));

    expect(response.headers.get('accept-ranges')).toBeNull();
    expect(response.headers.get('content-range')).toBeNull();
    expect(response.headers.get('content-length')).toBe('5');
  });

  it('keeps Jamendo credentials server-controlled', async () => {
    process.env.JAMENDO_CLIENT_ID = 'configured-client';
    process.env.JAMENDO_CLIENT_SECRET = 'must-not-be-sent';
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        headers: { status: 'success', next: 'https://api.jamendo.com/v3.0/tracks?client_id=configured-client' },
        results: [],
      }),
    );

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
    const body = (await response.json()) as { headers?: { next?: string } };
    expect(body.headers?.next).toBeUndefined();
  });

  it('preserves Jamendo application-level failures', async () => {
    process.env.JAMENDO_CLIENT_ID = 'configured-client';
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        headers: { status: 'failed', error_message: 'Invalid credentials' },
      }),
    );

    const response = await GET(request('jamendo/tracks'), context(['jamendo', 'tracks']));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid credentials' });
  });

  it('rejects invalid Jamendo stream IDs before fetching', async () => {
    process.env.JAMENDO_CLIENT_ID = 'configured-client';

    const response = await GET(request('jamendo/stream/not-a-number'), context(['jamendo', 'stream', 'not-a-number']));

    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns an honest configuration failure when Jamendo is not configured', async () => {
    const response = await GET(request('jamendo/tracks'), context(['jamendo', 'tracks']));

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

    const invalidLimit = await GET(request('archive/tracks?limit=101'), context(['archive', 'tracks']));
    expect(invalidLimit.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('stops enriching Archive candidates once the limit is satisfied', async () => {
    const docs = Array.from({ length: 30 }, (_, index) => ({
      identifier: `item-${index}`,
      title: `Track ${index}`,
      creator: 'Performer',
      subject: ['jazz'],
      licenseurl: 'https://creativecommons.org/licenses/by/4.0/',
    }));

    vi.mocked(fetch).mockImplementation(async (url) => {
      if (String(url).includes('advancedsearch')) {
        return Response.json({ response: { docs } });
      }
      return Response.json({
        metadata: {
          title: 'Track',
          creator: 'Performer',
          subject: ['jazz'],
          licenseurl: 'https://creativecommons.org/licenses/by/4.0/',
        },
        files: [{ name: 'a.mp3', format: 'VBR MP3', length: '2:00', size: '1024' }],
      });
    });

    const response = await GET(request('archive/tracks?subject=jazz&limit=3'), context(['archive', 'tracks']));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { results: unknown[] };
    expect(body.results).toHaveLength(3);
    // One search request plus a bounded number of metadata lookups, not one per
    // candidate: enrichment is the expensive part and must not run 30 times.
    expect(vi.mocked(fetch).mock.calls.length).toBeLessThanOrEqual(1 + 3 + ARCHIVE_ENRICHMENT_SLACK);
  });

  it('never CDN-caches an empty catalog response', async () => {
    process.env.JAMENDO_CLIENT_ID = 'configured-client';
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ headers: { status: 'success' }, results: [] }));

    const empty = await GET(request('jamendo/tracks?limit=10'), context(['jamendo', 'tracks']));

    expect(empty.status).toBe(200);
    // A transient empty answer must not be pinned in front of every client.
    expect(empty.headers.get('cache-control')).toBe('private, no-store');
    expect(empty.headers.get('cdn-cache-control')).toBe('private, no-store');

    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ headers: { status: 'success' }, results: [{ id: '1' }] }));
    const populated = await GET(request('jamendo/tracks?limit=10'), context(['jamendo', 'tracks']));
    expect(populated.headers.get('cache-control')).toContain('s-maxage=');
  });

  it('clamps a ccMixter request to the supported record ceiling', async () => {
    vi.mocked(fetch).mockImplementation(async () => Response.json([]));

    const response = await GET(request('ccmixter/tracks?limit=500'), context(['ccmixter', 'tracks']));

    expect(response.status).toBe(200);
    for (const call of vi.mocked(fetch).mock.calls) {
      expect(Number(new URL(String(call[0])).searchParams.get('limit'))).toBeLessThanOrEqual(100);
    }
  });

  it('pages ccMixter by offset when a page is truncated below the request', async () => {
    // A page shrunk by header overflow must resume from the records already
    // collected instead of restarting or stopping short.
    let call = 0;
    vi.mocked(fetch).mockImplementation(async (url) => {
      const offset = Number(new URL(String(url)).searchParams.get('offset'));
      call += 1;
      if (call === 1) {
        // First attempt overflows, forcing the page size down.
        throw Object.assign(new TypeError('fetch failed'), {
          cause: { code: 'UND_ERR_HEADERS_OVERFLOW' },
        });
      }
      const size = Number(new URL(String(url)).searchParams.get('limit'));
      return Response.json(Array.from({ length: size }, (_, index) => ({ upload_id: offset + index })));
    });

    const response = await GET(request('ccmixter/tracks?tags=remix&limit=100'), context(['ccmixter', 'tracks']));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { results: Array<{ upload_id: number }> };
    expect(body.results).toHaveLength(100);
    expect(body.results.at(-1)?.upload_id).toBe(99);

    const offsets = vi
      .mocked(fetch)
      .mock.calls.slice(1)
      .map((entry) => Number(new URL(String(entry[0])).searchParams.get('offset')));
    // Offsets advance monotonically, so no record is fetched twice.
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(new Set(offsets).size).toBe(offsets.length);
  });

  it('stops paging ccMixter as soon as the requested count is satisfied', async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      Response.json(Array.from({ length: 30 }, (_, index) => ({ upload_id: index }))),
    );

    const response = await GET(request('ccmixter/tracks?tags=remix&limit=30'), context(['ccmixter', 'tracks']));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { results: unknown[] };
    expect(body.results).toHaveLength(30);
    // A full page that already satisfies the request must not trigger another.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('stops paging ccMixter once a short page signals the end of results', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json([{ upload_id: 1 }]));

    const response = await GET(request('ccmixter/tracks?tags=remix&limit=40'), context(['ccmixter', 'tracks']));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ results: [{ upload_id: 1 }] });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reports a persistently empty ccMixter body as degraded rather than as no results', async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response('', { status: 200 }));

    const response = await GET(request('ccmixter/tracks?tags=remix'), context(['ccmixter', 'tracks']));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      results: [],
      degraded: true,
      reason: 'upstream-empty-response',
    });
    // The page shrinks toward a single record before giving up.
    const sizes = vi.mocked(fetch).mock.calls.map((call) => Number(new URL(String(call[0])).searchParams.get('limit')));
    expect(sizes.at(-1)).toBe(1);
    expect(sizes.length).toBeGreaterThan(1);
  });

  it('retries a smaller ccMixter page when an oversized header aborts the response', async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(
        Object.assign(new TypeError('fetch failed'), {
          cause: { code: 'UND_ERR_HEADERS_OVERFLOW' },
        }),
      )
      .mockResolvedValueOnce(Response.json([{ upload_id: 1 }]));

    const response = await GET(request('ccmixter/tracks?tags=remix&limit=100'), context(['ccmixter', 'tracks']));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ results: [{ upload_id: 1 }] });
    const sizes = vi.mocked(fetch).mock.calls.map((call) => Number(new URL(String(call[0])).searchParams.get('limit')));
    expect(sizes[0]).toBeGreaterThan(sizes[1]);
  });

  it('keeps earlier ccMixter pages when a later page fails', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json(Array.from({ length: 20 }, (_, index) => ({ upload_id: index }))))
      .mockResolvedValueOnce(new Response('', { status: 200 }));

    const response = await GET(request('ccmixter/tracks?tags=remix&limit=40'), context(['ccmixter', 'tracks']));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { results: unknown[]; degraded?: boolean };
    expect(body.results).toHaveLength(20);
    expect(body.degraded).toBeUndefined();
  });

  it('refuses a ccMixter upload without an MP3 file', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json([
        {
          files: [{ download_url: 'https://example.com/notes.txt', file_format_info: { mime_type: 'text/plain' } }],
        },
      ]),
    );

    const response = await GET(request('ccmixter/stream/123'), context(['ccmixter', 'stream', '123']));

    expect(response.status).toBe(404);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('uses the verified ccMixter MP3 instead of the first arbitrary file', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json([
          {
            files: [
              { download_url: 'https://example.com/notes.txt', file_format_info: { mime_type: 'text/plain' } },
              {
                download_url: 'https://ccmixter.org/content/artist/song.mp3',
                file_format_info: { mime_type: 'audio/mpeg' },
              },
            ],
          },
        ]),
      )
      .mockResolvedValueOnce(
        new Response('music', {
          status: 206,
          headers: { 'content-type': 'audio/mpeg', 'content-range': 'bytes 0-4/10' },
        }),
      );

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
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json([
        {
          files: [{ download_url: 'https://example.com/song.mp3', file_format_info: { mime_type: 'audio/mpeg' } }],
        },
      ]),
    );

    const response = await GET(request('ccmixter/stream/123'), context(['ccmixter', 'stream', '123']));

    expect(response.status).toBe(502);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('uses Archive metadata files directly without probing the full media URL', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({
          files: [
            { name: 'notes.txt', format: 'Text' },
            { name: 'actual track.mp3', format: 'VBR MP3', length: '00:03:12', size: 12345 },
          ],
        }),
      )
      .mockResolvedValueOnce(
        new Response('music', {
          status: 200,
          headers: { 'content-type': 'audio/mpeg' },
        }),
      );

    const response = await GET(request('archive/stream/valid-item_1'), context(['archive', 'stream', 'valid-item_1']));

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe('https://archive.org/metadata/valid-item_1');
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toBe(
      'https://archive.org/download/valid-item_1/actual%20track.mp3',
    );
  });

  it('returns 404 when Archive metadata has no MP3', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        files: [{ name: 'notes.txt', format: 'Text' }],
      }),
    );

    const response = await GET(request('archive/stream/valid-item_1'), context(['archive', 'stream', 'valid-item_1']));

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
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        files: [
          { name: 'zero-length.mp3', format: 'VBR MP3', length: 0, size: 100 },
          { name: 'zero-size.mp3', format: 'VBR MP3', length: 0, size: 0 },
        ],
      }),
    );

    const response = await GET(request('archive/stream/item'), context(['archive', 'stream', 'item']));

    expect(response.status).toBe(404);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('binds an Archive stream to the exact requested playable file', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({
          files: [
            { name: 'track.mp3', format: 'VBR MP3', length: 10, size: 100 },
            { name: 'other.mp3', format: 'VBR MP3', length: 10, size: 100 },
          ],
        }),
      )
      .mockResolvedValueOnce(
        new Response('music', {
          status: 206,
          headers: {
            'content-type': 'audio/mpeg',
            'content-range': 'bytes 0-4/10',
          },
        }),
      );

    const response = await GET(
      request('archive/stream/item?file=track.mp3', { range: 'bytes=0-4' }),
      context(['archive', 'stream', 'item']),
    );

    expect(response.status).toBe(206);
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toBe('https://archive.org/download/item/track.mp3');
    expect(vi.mocked(fetch).mock.calls[1][1]?.headers).toEqual(new Headers({ range: 'bytes=0-4' }));
  });

  it('enriches Archive catalog records and omits spoken-word records', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({
          response: {
            docs: [
              {
                identifier: 'music-item',
                title: 'Catalog title',
                creator: 'Catalog creator',
                licenseurl: 'http://creativecommons.org/licenses/by/4.0/',
              },
              {
                identifier: 'spoken-item',
                title: 'An audiobook lecture',
                creator: 'Reader',
                licenseurl: 'https://creativecommons.org/licenses/by/4.0/',
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          metadata: {
            title: 'Verified song',
            creator: 'Verified artist',
            subject: ['jazz'],
            year: 2024,
            licenseurl: 'http://creativecommons.org/licenses/by-sa/4.0/',
          },
          files: [{ name: 'verified.mp3', format: 'VBR MP3', length: '01:02', size: 2048, bitrate: 192 }],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          metadata: {
            title: 'Audiobook lecture',
            creator: 'Reader',
            licenseurl: 'https://creativecommons.org/licenses/by/4.0/',
          },
          files: [{ name: 'spoken.mp3', format: 'VBR MP3', length: 100, size: 2048 }],
        }),
      );

    const response = await GET(
      request('archive/tracks?creator=Example%20Artist&limit=10'),
      context(['archive', 'tracks']),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      results: [
        {
          identifier: 'music-item',
          title: 'Verified song',
          creator: 'Verified artist',
          subject: ['jazz'],
          year: '2024',
          filename: 'verified.mp3',
          duration: 62,
          size: 2048,
          bitRate: 192,
          contentType: 'audio/mpeg',
          suffix: 'mp3',
          streamUrl: '/api/music/archive/stream/music-item?file=verified.mp3',
          sourceUrl: 'https://archive.org/details/music-item',
          creatorUrl: '',
          licenseName: 'CC BY-SA',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
          attributionUrl: 'https://archive.org/details/music-item',
        },
      ],
    });
  });

  it('returns an empty degraded catalog when ccMixter is unavailable', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('unavailable', { status: 502 }));

    const response = await GET(request('ccmixter/tracks'), context(['ccmixter', 'tracks']));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ results: [], degraded: true });
  });

  it('preserves provider HTTP failures rather than returning a successful empty payload', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('unavailable', { status: 503 }));

    const response = await GET(request('archive/tracks'), context(['archive', 'tracks']));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: 'Archive upstream error' });
  });

  it('resolves an Apple preview from the lookup response rather than trusting a supplied URL', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({
          results: [{ trackId: 101, previewUrl: 'https://audio-ssl.itunes.apple.com/preview.m4a' }],
        }),
      )
      .mockResolvedValueOnce(new Response('audio', { status: 200, headers: { 'content-type': 'audio/mp4' } }));

    const response = await GET(request('itunes/stream/101'), context(['itunes', 'stream', '101']));

    expect(response.status).toBe(200);
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toBe('https://audio-ssl.itunes.apple.com/preview.m4a');
  });

  it('refuses an Apple preview served from an unapproved host', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        results: [{ trackId: 101, previewUrl: 'https://attacker.example/preview.m4a' }],
      }),
    );

    const response = await GET(request('itunes/stream/101'), context(['itunes', 'stream', '101']));

    expect(response.status).toBe(404);
    // The lookup happened; the media fetch never did.
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('rejects an unsupported Apple entity and an oversized id list before fetching', async () => {
    const badEntity = await GET(request('itunes/search?term=jazz&entity=tvEpisode'), context(['itunes', 'search']));
    const tooManyIds = await GET(
      request(`itunes/lookup?id=${Array.from({ length: 51 }, (_, index) => index + 1).join(',')}`),
      context(['itunes', 'lookup']),
    );

    expect(badEntity.status).toBe(400);
    expect(tooManyIds.status).toBe(400);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('pins the Apple request to music and rejects a term the caller left empty', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ results: [] }));

    const empty = await GET(request('itunes/search?term=%20'), context(['itunes', 'search']));
    expect(empty.status).toBe(400);

    await GET(request('itunes/search?term=jazz&media=movie'), context(['itunes', 'search']));

    const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
    expect(url.searchParams.get('media')).toBe('music');
    expect(url.searchParams.get('country')).toBe('us');
  });
});
