export type RouteBucket =
  | 'jamendo:tracks'
  | 'jamendo:albums'
  | 'jamendo:artists'
  | 'jamendo:stream'
  | 'ccmixter:tracks'
  | 'ccmixter:stream'
  | 'archive:tracks'
  | 'archive:stream'
  | 'itunes:search'
  | 'itunes:lookup'
  | 'itunes:stream'
  | 'deezer:tracks'
  | 'deezer:albums'
  | 'deezer:artists'
  | 'deezer:stream'
  | 'qq:tracks'
  | 'qq:stream'
  | 'audius:tracks'
  | 'audius:albums'
  | 'audius:artists'
  | 'openverse:tracks'
  | 'somafm:stations'
  | 'somafm:stream'
  | 'nts:stations'
  | 'radio:stations'
  | 'wikimedia:tracks'
  | 'wikimedia:stream'
  | 'invalid';

const validBuckets = new Set<RouteBucket>([
  'jamendo:tracks',
  'jamendo:albums',
  'jamendo:artists',
  'jamendo:stream',
  'ccmixter:tracks',
  'ccmixter:stream',
  'archive:tracks',
  'archive:stream',
  'itunes:search',
  'itunes:lookup',
  'itunes:stream',
  'deezer:tracks',
  'deezer:albums',
  'deezer:artists',
  'deezer:stream',
  'qq:tracks',
  'qq:stream',
  'audius:tracks',
  'audius:albums',
  'audius:artists',
  'openverse:tracks',
  'somafm:stations',
  'somafm:stream',
  'nts:stations',
  'radio:stations',
  'wikimedia:tracks',
  'wikimedia:stream',
]);

export function classifyRoute(
  provider: string | undefined,
  resource: string | undefined,
): { bucket: RouteBucket; isStream: boolean } {
  const bucket = `${provider}:${resource}` as RouteBucket;
  return validBuckets.has(bucket)
    ? { bucket, isStream: bucket.endsWith(':stream') }
    : { bucket: 'invalid', isStream: false };
}
