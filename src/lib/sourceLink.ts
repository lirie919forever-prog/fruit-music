export function getSourceLinkLabel(sourceUrl: string): string {
  try {
    const hostname = new URL(sourceUrl).hostname.replace(/^www\./i, '');
    return hostname ? `Open source page on ${hostname}` : 'Open source page';
  } catch {
    return 'Open source page';
  }
}
