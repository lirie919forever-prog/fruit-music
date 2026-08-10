/**
 * Kuwo rotates playback through regional CDN nodes. Keep the accepted hosts
 * narrow while allowing the node naming pattern used by its public resolver,
 * plus the stable legacy media hosts.
 */
const KUWO_MEDIA_NODE = /^kw-[a-z0-9-]+\.kuwo\.cn$/;
const KUWO_MEDIA_HOSTS = new Set(['panspace.kuwo.cn', 'sycdn.kuwo.cn']);

export function isKuwoMediaHost(url: URL): boolean {
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false;
  const host = url.hostname.toLowerCase();
  return KUWO_MEDIA_HOSTS.has(host) || host.endsWith('.sycdn.kuwo.cn') || KUWO_MEDIA_NODE.test(host);
}
