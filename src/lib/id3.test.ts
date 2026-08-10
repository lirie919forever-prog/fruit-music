import { describe, expect, it } from 'vitest';
import { parseId3Tags } from './id3';

function id3TextFrame(id: string, value: string): Uint8Array {
  const text = new TextEncoder().encode(value);
  const payload = new Uint8Array(text.length + 1);
  payload[0] = 3;
  payload.set(text, 1);
  const frame = new Uint8Array(10 + payload.length);
  frame.set(new TextEncoder().encode(id), 0);
  frame[4] = (payload.length >>> 24) & 0xff;
  frame[5] = (payload.length >>> 16) & 0xff;
  frame[6] = (payload.length >>> 8) & 0xff;
  frame[7] = payload.length & 0xff;
  frame.set(payload, 10);
  return frame;
}

function id3Tag(...frames: Uint8Array[]): ArrayBuffer {
  const bodyLength = frames.reduce((total, frame) => total + frame.length, 0);
  const tag = new Uint8Array(10 + bodyLength);
  tag.set(new TextEncoder().encode('ID3'), 0);
  tag[3] = 3;
  tag[6] = (bodyLength >>> 21) & 0x7f;
  tag[7] = (bodyLength >>> 14) & 0x7f;
  tag[8] = (bodyLength >>> 7) & 0x7f;
  tag[9] = bodyLength & 0x7f;
  let offset = 10;
  for (const frame of frames) {
    tag.set(frame, offset);
    offset += frame.length;
  }
  return tag.buffer;
}

describe('ID3 parser', () => {
  it('extracts common text frames without blocking the caller', () => {
    expect(
      parseId3Tags(
        id3Tag(id3TextFrame('TIT2', 'A title'), id3TextFrame('TPE1', 'An artist'), id3TextFrame('TALB', 'An album')),
      ),
    ).toEqual({ title: 'A title', artist: 'An artist', album: 'An album' });
  });

  it('returns an empty shape for a file without an ID3 header', () => {
    expect(parseId3Tags(new ArrayBuffer(4))).toEqual({});
  });
});
