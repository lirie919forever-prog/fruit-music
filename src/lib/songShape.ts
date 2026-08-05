import type { Song } from '@/types/music';
import { isRuntimeProviderName } from '@/lib/sourceRegistry';

/**
 * The shape check every untrusted `Song` has to pass before it reaches render.
 *
 * "Untrusted" means anything the app did not build in this process: a
 * rehydrated storage payload, or a JSON body from our own API — which is still
 * a network response, and the one data path that used to be cast to `Song[]`
 * and handed straight to the UI.
 *
 * The fields listed are every string the UI reads without a guard, plus the one
 * number it does arithmetic on. Anything short of this reaches a row and throws
 * on `.toLowerCase()`, or renders with no key.
 */
const REQUIRED_STRINGS = [
  'id',
  'title',
  'artist',
  'artistId',
  'album',
  'albumId',
  'coverArt',
  'path',
  'provider',
  'licenseName',
] as const;

export function isSong(value: unknown): value is Song {
  if (typeof value !== 'object' || value === null) return false;
  const song = value as Record<string, unknown>;
  return (
    REQUIRED_STRINGS.every((field) => typeof song[field] === 'string') &&
    song.id !== '' &&
    typeof song.duration === 'number' &&
    Number.isFinite(song.duration) &&
    typeof song.provider === 'string' &&
    isRuntimeProviderName(song.provider)
  );
}
