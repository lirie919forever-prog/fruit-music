import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  isAudioPath,
  isBackgroundImagePath,
  isSafeBackgroundFileUrl,
  isSafeExternalUrl,
  isTrustedRendererUrl,
  isSafeSettingsPayload,
} = require('./validation.cjs');
const { isDesktopLibraryRecord, mediaIdFromUrl, mediaUrlForId } = require('./mediaLibrary.cjs');

describe('desktop validation', () => {
  it('allows only supported local audio extensions', () => {
    expect(isAudioPath('C:\\Music\\track.mp3')).toBe(true);
    expect(isAudioPath('C:\\Music\\cover.jpg')).toBe(false);
    expect(isAudioPath('')).toBe(false);
  });

  it('allows only supported background image extensions', () => {
    expect(isBackgroundImagePath('C:\\Pictures\\cover.webp')).toBe(true);
    expect(isBackgroundImagePath('C:\\Pictures\\cover.mp3')).toBe(false);
  });

  it('allows only HTTP(S) external links', () => {
    expect(isSafeExternalUrl('https://music.apple.com/us/new')).toBe(true);
    expect(isSafeExternalUrl('http://localhost:3011')).toBe(true);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('file:///C:/Windows/system.ini')).toBe(false);
  });

  it('trusts only loopback renderer URLs for the privileged preload bridge', () => {
    expect(isTrustedRendererUrl('http://localhost:3011/new?view=new')).toBe(true);
    expect(isTrustedRendererUrl('http://127.0.0.1:3021')).toBe(true);
    expect(isTrustedRendererUrl('https://localhost:3011')).toBe(false);
    expect(isTrustedRendererUrl('http://localhost.attacker.test:3011')).toBe(false);
    expect(isTrustedRendererUrl('https://marea.example.com')).toBe(false);
  });

  it('accepts only bounded, typed settings payloads', () => {
    const settings = {
      theme: 'ocean',
      accentColor: '#0d6fa8',
      fontScale: 'standard',
      appBackground: 'ocean',
      appBackgroundImage: null,
      background: 'wash',
      playerBackgroundImage: null,
      backgroundOpacity: 1,
      backgroundBlur: 130,
      backgroundBrightness: 1,
      backgroundSaturation: 1.35,
      sidebarMode: 'expanded',
      queuePanelMode: 'expanded',
      fontFamily: 'body',
      fontWeight: 'medium',
      lyricScale: 'standard',
      letterSpacing: 'standard',
      reducedMotion: false,
    };
    expect(isSafeSettingsPayload(settings)).toBe(true);
    expect(isSafeSettingsPayload({ ...settings, accentColor: 'javascript:alert(1)' })).toBe(false);
    expect(isSafeSettingsPayload({ ...settings, reducedMotion: 'false' })).toBe(false);
  });

  it('keeps persisted background file URLs inside the app-owned directory', () => {
    const root = 'C:\\Users\\louis\\AppData\\Roaming\\Marea\\backgrounds';
    const inside = pathToFileURL(`${root}\\cover.webp`).href;
    const outside = pathToFileURL('C:\\Users\\louis\\Pictures\\cover.webp').href;
    expect(isSafeBackgroundFileUrl(inside, root)).toBe(true);
    expect(isSafeBackgroundFileUrl(outside, root)).toBe(false);
  });

  it('uses opaque, bounded media capabilities instead of renderer file paths', () => {
    const id = 'local-desktop-7b9a7a63-f3cb-48c1-97c1-a7409af04c6b';
    const url = mediaUrlForId(id);
    expect(url).toBe(`marea-media://audio/${id}`);
    expect(mediaIdFromUrl(url)).toBe(id);
    expect(mediaIdFromUrl('marea-media://audio/C:/Music/track.mp3')).toBeNull();
    expect(mediaIdFromUrl('marea-media://other/' + id)).toBeNull();
    expect(
      isDesktopLibraryRecord({
        id,
        path: 'C:\\Music\\track.flac',
        name: 'track.flac',
        size: 84_000_000,
        lastModified: 1_700_000_000_000,
      }),
    ).toBe(true);
  });
});
