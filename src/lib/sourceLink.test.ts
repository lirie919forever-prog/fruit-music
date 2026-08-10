import { describe, expect, it } from 'vitest';
import { getSourceLinkLabel } from './sourceLink';

describe('source link labels', () => {
  it('names the actual landing-page host instead of the catalog provider', () => {
    expect(getSourceLinkLabel('https://www.jamendo.com/track/710585')).toBe('Open source page on jamendo.com');
  });

  it('falls back safely for an invalid URL', () => {
    expect(getSourceLinkLabel('not a URL')).toBe('Open source page');
  });
});
