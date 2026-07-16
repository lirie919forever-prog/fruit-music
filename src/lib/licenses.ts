const LICENSE_LABELS: Array<[string, string]> = [
  ['/by-nc-nd/', 'CC BY-NC-ND'],
  ['/by-nc-sa/', 'CC BY-NC-SA'],
  ['/by-nc/', 'CC BY-NC'],
  ['/by-nd/', 'CC BY-ND'],
  ['/by-sa/', 'CC BY-SA'],
  ['/by/', 'CC BY'],
  ['/publicdomain/zero/', 'CC0'],
];

export function normalizeCreativeCommonsUrl(value: unknown): string {
  const candidates = Array.isArray(value) ? value : [value];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    try {
      const url = new URL(candidate);
      if (url.hostname !== 'creativecommons.org' && url.hostname !== 'www.creativecommons.org') continue;
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
      url.protocol = 'https:';
      return url.toString();
    } catch {
      continue;
    }
  }
  return '';
}

export function creativeCommonsName(url: string): string {
  const pathname = new URL(url).pathname.toLowerCase();
  return LICENSE_LABELS.find(([fragment]) => pathname.includes(fragment))?.[1] ?? '';
}

export function normalizeCreativeCommonsLicense(value: unknown): { name: string; url: string } | null {
  const url = normalizeCreativeCommonsUrl(value);
  if (!url) return null;
  const name = creativeCommonsName(url);
  return name ? { name, url } : null;
}
