export type RouteBucket =
  | 'jamendo:tracks'
  | 'jamendo:albums'
  | 'jamendo:artists'
  | 'jamendo:stream'
  | 'ccmixter:tracks'
  | 'ccmixter:stream'
  | 'archive:tracks'
  | 'archive:stream'
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
]);

export function classifyRoute(provider: string | undefined, resource: string | undefined): { bucket: RouteBucket; isStream: boolean } {
  const bucket = `${provider}:${resource}` as RouteBucket;
  return validBuckets.has(bucket)
    ? { bucket, isStream: bucket.endsWith(':stream') }
    : { bucket: 'invalid', isStream: false };
}
