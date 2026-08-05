import type { Song } from '@/types/music';
import type { DesktopAudioSelection, MareaDesktopBridge } from '@/types/desktop';
import type { Id3Metadata } from '@/lib/id3';
import { parseId3MetadataBuffer, readId3Metadata } from '@/lib/musicWorker';

const DATABASE_NAME = 'marea-local-music';
const DATABASE_VERSION = 1;
const STORE_NAME = 'tracks';
const AUDIO_EXTENSION = /\.(aac|flac|m4a|mp3|oga|ogg|wav|webm)$/i;
const AUDIO_METADATA_TIMEOUT_MS = 10_000;

// Object URLs are scoped to the current document. Reusing one per record keeps
// hydration, provider fallback, and the local-library view on the same URL and
// gives the hook one owner to revoke when the library is unmounted.
const objectUrlById = new Map<string, string>();

export interface LocalTrackRecord {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  fileName: string;
  type: string;
  duration: number;
  size: number;
  lastModified: number;
  blob: Blob;
}

export function isAudioFile(file: File): boolean {
  return file.type.startsWith('audio/') || AUDIO_EXTENSION.test(file.name);
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local music library'));
  });
}

async function readRecords(): Promise<LocalTrackRecord[]> {
  const database = await openDatabase();
  if (!database) return [];
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const records = await requestResult(transaction.objectStore(STORE_NAME).getAll());
    return records.sort((left, right) => left.fileName.localeCompare(right.fileName));
  } finally {
    database.close();
  }
}

async function readRecord(id: string): Promise<LocalTrackRecord | null> {
  const database = await openDatabase();
  if (!database) return null;
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const record = await requestResult(transaction.objectStore(STORE_NAME).get(id));
    return record ?? null;
  } finally {
    database.close();
  }
}

async function writeRecords(records: LocalTrackRecord[]): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    records.forEach((record) => store.put(record));
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

async function deleteRecord(id: string): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(id);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

async function clearRecords(): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).clear();
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

function localId(file: File): string {
  return `local-${encodeURIComponent(`${file.name}:${file.size}:${file.lastModified}`)}`;
}

function fileTitle(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, '') || fileName;
}

async function readDuration(source: Blob | string): Promise<number> {
  if (typeof Audio === 'undefined') return 0;
  const ownsObjectUrl = typeof source !== 'string';
  const url = ownsObjectUrl ? URL.createObjectURL(source) : source;
  const audio = new Audio();
  audio.preload = 'metadata';
  return new Promise((resolve) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    const finish = (duration: number) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.removeAttribute('src');
      audio.load();
      if (ownsObjectUrl) URL.revokeObjectURL(url);
      resolve(Number.isFinite(duration) && duration > 0 ? duration : 0);
    };
    audio.onloadedmetadata = () => finish(audio.duration);
    audio.onerror = () => finish(0);
    timeoutId = setTimeout(() => finish(0), AUDIO_METADATA_TIMEOUT_MS);
    audio.src = url;
  });
}

async function fileToRecord(file: File): Promise<LocalTrackRecord> {
  const [duration, metadata] = await Promise.all([readDuration(file), readId3Metadata(file)]);
  return {
    id: localId(file),
    title: metadata.title ?? fileTitle(file.name),
    artist: metadata.artist,
    album: metadata.album,
    fileName: file.name,
    type: file.type || 'audio/mpeg',
    duration,
    size: file.size,
    lastModified: file.lastModified,
    blob: file,
  };
}

export function localRecordToSong(record: LocalTrackRecord): Song {
  const existingUrl = objectUrlById.get(record.id);
  const path = existingUrl ?? URL.createObjectURL(record.blob);
  if (!existingUrl) objectUrlById.set(record.id, path);

  return {
    id: record.id,
    title: record.title,
    artist: record.artist?.trim() || 'Local file',
    artistId: 'local-files',
    album: record.album?.trim() || 'Local library',
    albumId: 'local-library',
    coverArt: '/placeholder-album.svg',
    duration: record.duration,
    track: 0,
    year: 0,
    genre: 'Local',
    path,
    bitRate: 0,
    contentType: record.type,
    suffix: record.fileName.split('.').pop() ?? 'mp3',
    size: record.size,
    provider: 'Local file',
    sourceUrl: '',
    creatorUrl: '',
    licenseName: 'Local file',
    licenseUrl: '',
    attributionUrl: '',
    metadataVerified: true,
  };
}

/** Desktop records use an opaque Electron protocol URL, never a local path. */
export function isDesktopLocalSong(song: Pick<Song, 'path'>): boolean {
  return song.path.startsWith('marea-media://audio/');
}

/**
 * Builds a normal Song from a main-process library selection. The only bytes
 * that cross IPC are a bounded metadata header; playback streams via the
 * opaque media URL instead of copying the full file into IndexedDB.
 */
export async function desktopSelectionToSong(
  selection: DesktopAudioSelection,
  bridge: Pick<MareaDesktopBridge, 'readAudioHeader'>,
): Promise<Song> {
  const [duration, metadata] = await Promise.all([
    readDuration(selection.url),
    bridge
      .readAudioHeader(selection.id)
      .then((buffer) => parseId3MetadataBuffer(buffer))
      .catch((): Id3Metadata => ({})),
  ]);

  return {
    id: selection.id,
    title: metadata.title ?? fileTitle(selection.name),
    artist: metadata.artist?.trim() || 'Local file',
    artistId: 'local-files',
    album: metadata.album?.trim() || 'Local library',
    albumId: 'local-library',
    coverArt: '/placeholder-album.svg',
    duration,
    track: 0,
    year: 0,
    genre: 'Local',
    path: selection.url,
    bitRate: 0,
    contentType: 'audio/*',
    suffix: selection.name.split('.').pop() ?? 'mp3',
    size: selection.size,
    provider: 'Local file',
    sourceUrl: '',
    creatorUrl: '',
    licenseName: 'Local file',
    licenseUrl: '',
    attributionUrl: '',
    metadataVerified: true,
  };
}

/**
 * Resolves a persisted local-song identity to the current document's object
 * URL. The stored `path` may belong to a previous page load and is therefore
 * not usable after a reload, but the IndexedDB record is keyed by a stable id.
 */
export async function loadLocalSong(id: string): Promise<Song | null> {
  try {
    const record = await readRecord(id);
    return record ? localRecordToSong(record) : null;
  } catch {
    return null;
  }
}

export function revokeLocalSong(song: Song): void {
  if (isDesktopLocalSong(song)) return;
  const cachedUrl = objectUrlById.get(song.id);
  if (cachedUrl === song.path) {
    objectUrlById.delete(song.id);
    URL.revokeObjectURL(cachedUrl);
    return;
  }
  if (song.path.startsWith('blob:')) URL.revokeObjectURL(song.path);
}

export async function loadLocalSongs(): Promise<Song[]> {
  try {
    return (await readRecords()).map(localRecordToSong);
  } catch {
    return [];
  }
}

export async function importLocalFiles(files: File[]): Promise<Song[]> {
  const accepted = files.filter(isAudioFile);
  if (accepted.length === 0) return [];
  const records = await Promise.all(accepted.map(fileToRecord));
  try {
    await writeRecords(records);
  } catch {
    // Object URLs still make the import usable for this session when storage is blocked.
  }
  return records.map(localRecordToSong);
}

export async function removeLocalFile(id: string): Promise<void> {
  try {
    await deleteRecord(id);
  } catch {
    // The in-memory library is still updated by the caller.
  }
}

export async function clearLocalFiles(): Promise<void> {
  try {
    await clearRecords();
  } catch {
    // The in-memory library is still cleared by the caller.
  }
}
