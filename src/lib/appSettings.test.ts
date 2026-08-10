import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  fontScaleValue,
  preparePersistedAppSettings,
  normalizeHexColor,
  resolveAppTheme,
  sanitizeAppSettings,
} from './appSettings';

describe('app settings', () => {
  it('normalizes short hex colors and rejects invalid values', () => {
    expect(normalizeHexColor('#0df', '#000000')).toBe('#00ddff');
    expect(normalizeHexColor('#0dff', '#000000')).toBe('#00ddffff');
    expect(normalizeHexColor('blue', '#000000')).toBe('#000000');
  });

  it('keeps malformed persisted settings inside the supported shape', () => {
    expect(
      sanitizeAppSettings({ theme: 'unknown', fontScale: 'huge', background: 'unsupported', reducedMotion: 'yes' }),
    ).toEqual(DEFAULT_APP_SETTINGS);
    expect(sanitizeAppSettings({ theme: 'midnight', accentColor: '#123456', reducedMotion: true })).toMatchObject({
      theme: 'midnight',
      accentColor: '#123456',
      reducedMotion: true,
    });
  });

  it('resolves system mode without changing the stored mode', () => {
    expect(resolveAppTheme('system', true)).toBe('midnight');
    expect(resolveAppTheme('system', false)).toBe('ocean');
    expect(resolveAppTheme('ocean', true)).toBe('ocean');
  });

  it('maps interface scale to a stable CSS value', () => {
    expect(fontScaleValue('small')).toBe('0.94');
    expect(fontScaleValue('standard')).toBe('1');
    expect(fontScaleValue('large')).toBe('1.08');
  });

  it('clamps visual background controls to safe persisted ranges', () => {
    expect(
      sanitizeAppSettings({
        background: 'gradient',
        backgroundOpacity: 4,
        backgroundBlur: -20,
        backgroundBrightness: 2,
        backgroundSaturation: 0,
      }),
    ).toMatchObject({
      background: 'gradient',
      backgroundOpacity: 1,
      backgroundBlur: 0,
      backgroundBrightness: 1.4,
      backgroundSaturation: 0.5,
    });
  });

  it('keeps browser-only image URLs out of persisted settings', () => {
    const settings = sanitizeAppSettings({
      appBackground: 'image',
      appBackgroundImage: 'blob:http://localhost/image',
      background: 'image',
      playerBackgroundImage: 'file:///C:/Marea/backgrounds/player.webp',
    });
    expect(settings.appBackgroundImage).toBe('blob:http://localhost/image');
    expect(preparePersistedAppSettings(settings)).toMatchObject({
      appBackground: 'ocean',
      appBackgroundImage: null,
      background: 'image',
      playerBackgroundImage: 'file:///C:/Marea/backgrounds/player.webp',
    });
  });
});
