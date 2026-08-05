export interface Id3Metadata {
  title?: string;
  artist?: string;
  album?: string;
}

function synchsafe(view: DataView, offset: number): number {
  return (
    ((view.getUint8(offset) & 0x7f) << 21) |
    ((view.getUint8(offset + 1) & 0x7f) << 14) |
    ((view.getUint8(offset + 2) & 0x7f) << 7) |
    (view.getUint8(offset + 3) & 0x7f)
  );
}

function uint32(view: DataView, offset: number): number {
  return view.getUint32(offset, false);
}

function decodeLatin1(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
}

function decodeText(bytes: Uint8Array): string {
  if (bytes.length <= 1) return '';
  const encoding = bytes[0];
  const payload = bytes.subarray(1);
  try {
    if (encoding === 0) return decodeLatin1(payload);
    if (encoding === 2) return new TextDecoder('utf-16be').decode(payload);
    if (encoding === 1) return new TextDecoder('utf-16').decode(payload);
    return new TextDecoder('utf-8').decode(payload);
  } catch {
    return new TextDecoder().decode(payload);
  }
}

function trimFrameText(value: string): string | undefined {
  const normalized = value.replace(/\0/g, '').trim();
  return normalized === '' ? undefined : normalized;
}

/** Reads the small set of ID3v2 text frames useful to a local music library. */
export function parseId3Tags(buffer: ArrayBuffer): Id3Metadata {
  const view = new DataView(buffer);
  if (view.byteLength < 10 || view.getUint8(0) !== 0x49 || view.getUint8(1) !== 0x44 || view.getUint8(2) !== 0x33) {
    return {};
  }

  const version = view.getUint8(3);
  const tagEnd = Math.min(view.byteLength, 10 + synchsafe(view, 6));
  const result: Id3Metadata = {};
  let offset = 10;

  while (offset + 10 <= tagEnd) {
    const frameId = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );
    if (!/^[A-Z0-9]{4}$/.test(frameId)) break;

    const frameSize = version >= 4 ? synchsafe(view, offset + 4) : uint32(view, offset + 4);
    const frameStart = offset + 10;
    const frameEnd = Math.min(tagEnd, frameStart + frameSize);
    if (frameEnd <= frameStart) break;

    if (frameId === 'TIT2' || frameId === 'TPE1' || frameId === 'TALB') {
      const value = trimFrameText(decodeText(new Uint8Array(buffer, frameStart, frameEnd - frameStart)));
      if (frameId === 'TIT2' && value) result.title ??= value;
      if (frameId === 'TPE1' && value) result.artist ??= value.split('\0')[0];
      if (frameId === 'TALB' && value) result.album ??= value;
    }

    offset = frameEnd;
  }

  return result;
}
