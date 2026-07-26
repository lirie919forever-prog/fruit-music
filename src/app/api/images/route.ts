import { NextResponse } from 'next/server';

const APPROVED_HOSTS = new Set([
  'usercontent.jamendo.com',
  'ccmixter.org',
  'www.ccmixter.org',
  'api.vkeys.cn',
  'is1-ssl.mzstatic.com',
]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp']);

function approvedUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
    return APPROVED_HOSTS.has(url.hostname.toLowerCase()) ? url : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const rawUrl = new URL(request.url).searchParams.get('url');
  const source = rawUrl ? approvedUrl(rawUrl) : null;
  if (!source) return NextResponse.json({ error: 'Artwork source is not approved' }, { status: 400 });

  try {
    const response = await fetch(source, {
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
      headers: { 'User-Agent': 'marea-artwork/1.0', Accept: 'image/avif,image/webp,image/jpeg,image/png' },
    });
    if (!response.ok) return new NextResponse('Artwork unavailable', { status: 502 });

    const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() || '';
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (!IMAGE_TYPES.has(contentType) || (contentLength > 0 && contentLength > MAX_IMAGE_BYTES)) {
      await response.body?.cancel();
      return new NextResponse('Invalid artwork response', { status: 502 });
    }

    const body = await response.arrayBuffer();
    if (body.byteLength > MAX_IMAGE_BYTES) return new NextResponse('Artwork too large', { status: 502 });
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(body.byteLength),
        'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
      },
    });
  } catch {
    return new NextResponse('Artwork unavailable', { status: 502 });
  }
}
