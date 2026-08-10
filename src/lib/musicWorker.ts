import { parseLrc, type LyricLine } from '@/lib/lyrics/lrc';
import { parseId3Tags, type Id3Metadata } from '@/lib/id3';

interface WorkerSuccess<T> {
  id: number;
  ok: true;
  result: T;
}

interface WorkerFailure {
  id: number;
  ok: false;
  error: string;
}

type WorkerResponse<T> = WorkerSuccess<T> | WorkerFailure;
type PendingTask = { resolve: (value: unknown) => void; reject: (reason?: unknown) => void };

let worker: Worker | null = null;
let nextTaskId = 0;
const pending = new Map<number, PendingTask>();

function rejectPending(error: Error): void {
  for (const task of pending.values()) task.reject(error);
  pending.clear();
  worker = null;
}

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (worker) return worker;

  try {
    worker = new Worker(new URL('../workers/musicMetadata.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerResponse<unknown>>) => {
      const response = event.data;
      const task = pending.get(response.id);
      if (!task) return;
      pending.delete(response.id);
      if (response.ok) task.resolve(response.result);
      else task.reject(new Error(response.error));
    };
    worker.onerror = () => rejectPending(new Error('Music worker failed'));
    return worker;
  } catch {
    worker = null;
    return null;
  }
}

function runWorkerTask<T>(message: Omit<Record<string, unknown>, 'id'>, transfer: Transferable[] = []): Promise<T> {
  const instance = getWorker();
  if (!instance) return Promise.reject(new Error('Music worker is unavailable'));

  const id = ++nextTaskId;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: (value) => resolve(value as T), reject });
    try {
      instance.postMessage({ ...message, id }, transfer);
    } catch (error) {
      pending.delete(id);
      reject(error);
    }
  });
}

export function parseLrcInWorker(source: string): Promise<LyricLine[]> {
  if (typeof Worker === 'undefined') return Promise.resolve(parseLrc(source));
  return runWorkerTask<LyricLine[]>({ kind: 'parse-lrc', source }).catch(() => parseLrc(source));
}

/** Parses a bounded ID3 header without ever requiring the full audio file in memory. */
export function parseId3MetadataBuffer(buffer: ArrayBuffer): Promise<Id3Metadata> {
  if (typeof Worker === 'undefined') return Promise.resolve(parseId3Tags(buffer));
  // Posting transfers ownership, so preserve the at-most-1 MiB header for the
  // synchronous fallback before the worker receives the original buffer.
  const fallback = buffer.slice(0);
  return runWorkerTask<Id3Metadata>({ kind: 'read-id3', buffer }, [buffer]).catch(() => parseId3Tags(fallback));
}

export async function readId3Metadata(file: Blob): Promise<Id3Metadata> {
  const buffer = await file.slice(0, 1024 * 1024).arrayBuffer();
  return parseId3MetadataBuffer(buffer);
}
