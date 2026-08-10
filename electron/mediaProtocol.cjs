const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { mediaIdFromUrl } = require('./mediaLibrary.cjs');

function emptyResponse(status) {
  return new Response(null, { status });
}

const CONTENT_TYPES = new Map([
  ['.aac', 'audio/aac'],
  ['.flac', 'audio/flac'],
  ['.m4a', 'audio/mp4'],
  ['.mp3', 'audio/mpeg'],
  ['.oga', 'audio/ogg'],
  ['.ogg', 'audio/ogg'],
  ['.wav', 'audio/wav'],
  ['.webm', 'audio/webm'],
]);

function parseSingleRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || size <= 0) return { invalid: true };

  const [, startText, endText] = match;
  let start;
  let end;
  if (startText === '') {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { invalid: true };
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText === '' ? size - 1 : Number(endText);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
      return { invalid: true };
    }
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

/** Streams an approved local file without loading it into the renderer. */
async function createLocalFileResponse(filePath, request) {
  const stat = await fsp.stat(filePath);
  if (!stat.isFile()) return emptyResponse(404);

  const size = stat.size;
  const range = parseSingleRange(request.headers.get('range'), size);
  if (range?.invalid) {
    return new Response(null, {
      status: 416,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes */${size}`,
      },
    });
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? Math.max(0, size - 1);
  const contentLength = size === 0 ? 0 : end - start + 1;
  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Headers': 'Range',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range, Content-Type',
    'Content-Length': String(contentLength),
    'Content-Type': CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream',
    'Last-Modified': stat.mtime.toUTCString(),
  });
  if (range) headers.set('Content-Range', `bytes ${start}-${end}/${size}`);

  const body =
    request.method === 'HEAD' || contentLength === 0
      ? null
      : Readable.toWeb(fs.createReadStream(filePath, { start, end }));
  return new Response(body, { status: range ? 206 : 200, headers });
}

/**
 * Creates the opaque local-audio request handler used by Electron's privileged
 * protocol. Resolution is injected so the handler never gets direct access to
 * the library map; only a validated record reaches the file fetcher.
 */
function createMediaProtocolHandler({ resolveRecord, fetchFile }) {
  if (typeof resolveRecord !== 'function' || typeof fetchFile !== 'function') {
    throw new TypeError('Media protocol dependencies are required');
  }

  return async function handleMediaRequest(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return emptyResponse(405);

    const id = mediaIdFromUrl(request.url);
    let record = null;
    try {
      record = id ? await resolveRecord(id) : null;
    } catch {
      return emptyResponse(404);
    }
    if (!record) return emptyResponse(404);

    try {
      // The fetcher forwards Range and HEAD semantics to Electron's file
      // handler, so lossless files stay streamed instead of crossing IPC as a
      // renderer-sized buffer.
      return await fetchFile(record.path, request);
    } catch {
      return emptyResponse(404);
    }
  };
}

module.exports = { createLocalFileResponse, createMediaProtocolHandler };
