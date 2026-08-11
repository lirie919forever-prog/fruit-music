/**
 * Kugou streams rotate through fs*.kugou.com CDN nodes. The player API returns
 * http URLs that we canonicalize to https before proxying; keep the accepted
 * hosts narrow to the Kugou domain while allowing the rotating node naming.
 */
const KUGOU_MEDIA_HOSTS = new Set([
  'fsandroid.tx.kugou.com',
  'fsmobile.kugou.com',
  'fsw.kugou.com',
  'fs.net.kugou.com',
]);
const KUGOU_MEDIA_NODE = /^fs[a-z]*\.kugou\.com$/;

export function isKugouMediaHost(url: URL): boolean {
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false;
  const host = url.hostname.toLowerCase();
  return KUGOU_MEDIA_HOSTS.has(host) || KUGOU_MEDIA_NODE.test(host) || host.endsWith('.kugou.com');
}