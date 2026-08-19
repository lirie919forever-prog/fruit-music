export type AppTheme = 'ocean' | 'midnight' | 'system';
export type FontScale = 'small' | 'standard' | 'large';
export type AppBackgroundMode = 'ocean' | 'plain' | 'image';
export type BackgroundMode = 'wash' | 'plain' | 'gradient' | 'image';
export type SidebarMode = 'expanded' | 'collapsed';
export type QueuePanelMode = 'expanded' | 'collapsed' | 'hidden';
export type FontFamily = 'body' | 'system' | 'display';
export type FontWeight = 'regular' | 'medium' | 'semibold';
export type LyricScale = 'small' | 'standard' | 'large';
export type LetterSpacing = 'standard' | 'relaxed' | 'wide';

export interface AppSettings {
  theme: AppTheme;
  accentColor: string;
  fontScale: FontScale;
  appBackground: AppBackgroundMode;
  appBackgroundImage: string | null;
  background: BackgroundMode;
  playerBackgroundImage: string | null;
  backgroundOpacity: number;
  backgroundBlur: number;
  backgroundBrightness: number;
  backgroundSaturation: number;
  sidebarMode: SidebarMode;
  queuePanelMode: QueuePanelMode;
  fontFamily: FontFamily;
  fontWeight: FontWeight;
  lyricScale: LyricScale;
  letterSpacing: LetterSpacing;
  reducedMotion: boolean;
}

export const APP_SETTINGS_KEY = 'marea-settings-v1';

export const DEFAULT_APP_SETTINGS: AppSettings = {
  // Marea's ocean surface is intentionally the default. The darker option is
  // an alternate reading mode, not a rebrand of the product surface.
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

const APP_THEMES: readonly AppTheme[] = ['ocean', 'midnight', 'system'];
const FONT_SCALES: readonly FontScale[] = ['small', 'standard', 'large'];
const APP_BACKGROUNDS: readonly AppBackgroundMode[] = ['ocean', 'plain', 'image'];
const BACKGROUNDS: readonly BackgroundMode[] = ['wash', 'plain', 'gradient', 'image'];
const SIDEBAR_MODES: readonly SidebarMode[] = ['expanded', 'collapsed'];
const QUEUE_PANEL_MODES: readonly QueuePanelMode[] = ['expanded', 'collapsed', 'hidden'];
const FONT_FAMILIES: readonly FontFamily[] = ['body', 'system', 'display'];
const FONT_WEIGHTS: readonly FontWeight[] = ['regular', 'medium', 'semibold'];
const LYRIC_SCALES: readonly LyricScale[] = ['small', 'standard', 'large'];
const LETTER_SPACINGS: readonly LetterSpacing[] = ['standard', 'relaxed', 'wide'];
const HEX_COLOR = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i;

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, value));
}

export function isHexColor(value: string): boolean {
  return HEX_COLOR.test(value.trim());
}

export function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !isHexColor(value)) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 4 || normalized.length === 5) {
    return `#${normalized
      .slice(1)
      .split('')
      .map((digit) => `${digit}${digit}`)
      .join('')}`;
  }
  return normalized;
}

export function isAllowedBackgroundImageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'file:' || protocol === 'blob:';
  } catch {
    return false;
  }
}

export function isPersistableBackgroundImageUrl(value: unknown): value is string {
  if (!isAllowedBackgroundImageUrl(value)) return false;
  return new URL(value).protocol === 'file:';
}

export function preparePersistedAppSettings(settings: AppSettings): AppSettings {
  const appBackgroundImage = isPersistableBackgroundImageUrl(settings.appBackgroundImage)
    ? settings.appBackgroundImage
    : null;
  const playerBackgroundImage = isPersistableBackgroundImageUrl(settings.playerBackgroundImage)
    ? settings.playerBackgroundImage
    : null;

  return {
    ...settings,
    appBackground: settings.appBackground === 'image' && !appBackgroundImage ? 'ocean' : settings.appBackground,
    appBackgroundImage,
    background: settings.background === 'image' && !playerBackgroundImage ? 'wash' : settings.background,
    playerBackgroundImage,
  };
}

export function sanitizeAppSettings(value: unknown): AppSettings {
  if (typeof value !== 'object' || value === null) return DEFAULT_APP_SETTINGS;
  const raw = value as Record<string, unknown>;
  return {
    theme: APP_THEMES.includes(raw.theme as AppTheme) ? (raw.theme as AppTheme) : DEFAULT_APP_SETTINGS.theme,
    accentColor: normalizeHexColor(raw.accentColor, DEFAULT_APP_SETTINGS.accentColor),
    fontScale: FONT_SCALES.includes(raw.fontScale as FontScale)
      ? (raw.fontScale as FontScale)
      : DEFAULT_APP_SETTINGS.fontScale,
    appBackground: APP_BACKGROUNDS.includes(raw.appBackground as AppBackgroundMode)
      ? (raw.appBackground as AppBackgroundMode)
      : DEFAULT_APP_SETTINGS.appBackground,
    appBackgroundImage: isAllowedBackgroundImageUrl(raw.appBackgroundImage) ? raw.appBackgroundImage : null,
    background: BACKGROUNDS.includes(raw.background as BackgroundMode)
      ? (raw.background as BackgroundMode)
      : DEFAULT_APP_SETTINGS.background,
    playerBackgroundImage: isAllowedBackgroundImageUrl(raw.playerBackgroundImage) ? raw.playerBackgroundImage : null,
    backgroundOpacity: boundedNumber(raw.backgroundOpacity, DEFAULT_APP_SETTINGS.backgroundOpacity, 0, 1),
    backgroundBlur: boundedNumber(raw.backgroundBlur, DEFAULT_APP_SETTINGS.backgroundBlur, 0, 180),
    backgroundBrightness: boundedNumber(raw.backgroundBrightness, DEFAULT_APP_SETTINGS.backgroundBrightness, 0.6, 1.4),
    backgroundSaturation: boundedNumber(raw.backgroundSaturation, DEFAULT_APP_SETTINGS.backgroundSaturation, 0.5, 1.8),
    sidebarMode: SIDEBAR_MODES.includes(raw.sidebarMode as SidebarMode)
      ? (raw.sidebarMode as SidebarMode)
      : DEFAULT_APP_SETTINGS.sidebarMode,
    queuePanelMode: QUEUE_PANEL_MODES.includes(raw.queuePanelMode as QueuePanelMode)
      ? (raw.queuePanelMode as QueuePanelMode)
      : DEFAULT_APP_SETTINGS.queuePanelMode,
    fontFamily: FONT_FAMILIES.includes(raw.fontFamily as FontFamily)
      ? (raw.fontFamily as FontFamily)
      : DEFAULT_APP_SETTINGS.fontFamily,
    fontWeight: FONT_WEIGHTS.includes(raw.fontWeight as FontWeight)
      ? (raw.fontWeight as FontWeight)
      : DEFAULT_APP_SETTINGS.fontWeight,
    lyricScale: LYRIC_SCALES.includes(raw.lyricScale as LyricScale)
      ? (raw.lyricScale as LyricScale)
      : DEFAULT_APP_SETTINGS.lyricScale,
    letterSpacing: LETTER_SPACINGS.includes(raw.letterSpacing as LetterSpacing)
      ? (raw.letterSpacing as LetterSpacing)
      : DEFAULT_APP_SETTINGS.letterSpacing,
    reducedMotion: typeof raw.reducedMotion === 'boolean' ? raw.reducedMotion : DEFAULT_APP_SETTINGS.reducedMotion,
  };
}

export function resolveAppTheme(theme: AppTheme, prefersDark: boolean): Exclude<AppTheme, 'system'> {
  if (theme === 'system') return prefersDark ? 'midnight' : 'ocean';
  return theme;
}

export function fontScaleValue(scale: FontScale): string {
  if (scale === 'small') return '0.94';
  if (scale === 'large') return '1.08';
  return '1';
}

export function fontFamilyValue(family: FontFamily): string {
  if (family === 'system') return 'ui-sans-serif, system-ui, sans-serif';
  if (family === 'display') return 'var(--font-heading, Georgia, serif)';
  return 'var(--font-body, var(--font-ui, ui-sans-serif, sans-serif))';
}

export function fontWeightValue(weight: FontWeight): string {
  if (weight === 'regular') return '400';
  if (weight === 'semibold') return '600';
  return '500';
}

export function lyricScaleValue(scale: LyricScale): string {
  if (scale === 'small') return '0.9';
  if (scale === 'large') return '1.16';
  return '1';
}

export function letterSpacingValue(spacing: LetterSpacing): string {
  if (spacing === 'relaxed') return '0.03em';
  if (spacing === 'wide') return '0.06em';
  return '0';
}
