import { parseLrc } from '@/lib/lyrics/lrc';
import { parseId3Tags, type Id3Metadata } from '@/lib/id3';

interface ParseLyricsRequest {
  id: number;
  kind: 'parse-lrc';
  source: string;
}

interface ReadId3Request {
  id: number;
  kind: 'read-id3';
  buffer: ArrayBuffer;
}

type WorkerRequest = ParseLyricsRequest | ReadId3Request;

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: unknown) => void;
};

workerScope.onmessage = (event) => {
  const request = event.data;
  try {
    const result: Id3Metadata | ReturnType<typeof parseLrc> =
      request.kind === 'parse-lrc' ? parseLrc(request.source) : parseId3Tags(request.buffer);
    workerScope.postMessage({ id: request.id, ok: true, result });
  } catch {
    workerScope.postMessage({ id: request.id, ok: false, error: 'Worker task failed' });
  }
};

export {};
