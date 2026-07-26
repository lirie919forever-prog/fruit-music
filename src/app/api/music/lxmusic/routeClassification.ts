export type RouteBucket = 'lxmusic:search' | 'lxmusic:url' | 'invalid';

const validBuckets = new Set<RouteBucket>(['lxmusic:search', 'lxmusic:url']);

export function classifyLxRoute(
  provider: string | undefined,
  resource: string | undefined,
): { bucket: RouteBucket; isStream: boolean } {
  const bucket = `${provider}:${resource}` as RouteBucket;
  return validBuckets.has(bucket)
    ? { bucket, isStream: bucket.endsWith(':url') }
    : { bucket: 'invalid', isStream: false };
}
