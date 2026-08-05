'use client';

import { Upload, Check, Monitor, Moon, Paintbrush, Play, Sparkles, Sun, Trash2, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { CoverArt } from '@/components/ui/CoverArt';
import { VirtualList } from '@/components/ui/VirtualList';
import { lockBodyScroll } from '@/lib/scrollLock';
import {
  fontFamilyValue,
  fontScaleValue,
  fontWeightValue,
  isHexColor,
  letterSpacingValue,
  lyricScaleValue,
  type AppBackgroundMode,
  type AppSettings,
  type AppTheme,
  type BackgroundMode,
  type FontFamily,
  type FontScale,
  type FontWeight,
  type LetterSpacing,
  type LyricScale,
  type QueuePanelMode,
  type SidebarMode,
} from '@/lib/appSettings';
import { usePlayerStore } from '@/store/playerStore';
import { getDesktopBridge } from '@/lib/desktopBridge';
import type { Song } from '@/types/music';

function focusableElements(container: HTMLElement | null): HTMLElement[] {
  return Array.from(
    container?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? [],
  ).filter((element) => element.offsetParent !== null);
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--:--';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

const THEME_OPTIONS: Array<{ value: AppTheme; label: string; detail: string; icon: React.ReactNode }> = [
  { value: 'ocean', label: 'Ocean', detail: 'Marea default', icon: <Sun className="h-4 w-4" aria-hidden /> },
  {
    value: 'midnight',
    label: 'Midnight',
    detail: 'Low-light blue',
    icon: <Moon className="h-4 w-4" aria-hidden />,
  },
  {
    value: 'system',
    label: 'System',
    detail: 'Follow device',
    icon: <Monitor className="h-4 w-4" aria-hidden />,
  },
];

const FONT_OPTIONS: Array<{ value: FontScale; label: string }> = [
  { value: 'small', label: 'Small' },
  { value: 'standard', label: 'Standard' },
  { value: 'large', label: 'Large' },
];

const APP_BACKGROUND_OPTIONS: Array<{ value: AppBackgroundMode; label: string }> = [
  { value: 'ocean', label: 'Ocean surface' },
  { value: 'plain', label: 'Clean surface' },
  { value: 'image', label: 'Custom image' },
];

const BACKGROUND_OPTIONS: Array<{ value: BackgroundMode; label: string }> = [
  { value: 'wash', label: 'Artwork wash' },
  { value: 'plain', label: 'Clean surface' },
  { value: 'gradient', label: 'Ocean gradient' },
  { value: 'image', label: 'Custom image' },
];

const FONT_FAMILY_OPTIONS: Array<{ value: FontFamily; label: string }> = [
  { value: 'body', label: 'Marea body' },
  { value: 'system', label: 'System' },
  { value: 'display', label: 'Display serif' },
];

const FONT_WEIGHT_OPTIONS: Array<{ value: FontWeight; label: string }> = [
  { value: 'regular', label: 'Regular' },
  { value: 'medium', label: 'Medium' },
  { value: 'semibold', label: 'Semibold' },
];

const LYRIC_SCALE_OPTIONS: Array<{ value: LyricScale; label: string }> = [
  { value: 'small', label: 'Small' },
  { value: 'standard', label: 'Standard' },
  { value: 'large', label: 'Large' },
];

const LETTER_SPACING_OPTIONS: Array<{ value: LetterSpacing; label: string }> = [
  { value: 'standard', label: 'Standard' },
  { value: 'relaxed', label: 'Relaxed' },
  { value: 'wide', label: 'Wide' },
];

const SIDEBAR_MODE_OPTIONS: Array<{ value: SidebarMode; label: string }> = [
  { value: 'expanded', label: 'Expanded' },
  { value: 'collapsed', label: 'Icon rail' },
];

const QUEUE_MODE_OPTIONS: Array<{ value: QueuePanelMode; label: string }> = [
  { value: 'expanded', label: 'Expanded' },
  { value: 'collapsed', label: 'Compact' },
  { value: 'hidden', label: 'Hidden' },
];

function SettingLabel({ title, detail }: { title: string; detail: string }) {
  return (
    <span className="min-w-0">
      <span className="block text-[13px] font-semibold text-[var(--salt-white)]">{title}</span>
      <span className="mt-0.5 block text-xs leading-relaxed text-[var(--salt-mist)]">{detail}</span>
    </span>
  );
}

function ToggleRow({
  checked,
  onChange,
  title,
  detail,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  detail: string;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-3">
      <SettingLabel title={title} detail={detail} />
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-5 w-5 shrink-0 accent-[var(--salt-primary)]"
      />
    </label>
  );
}

function RangeSetting({
  title,
  detail,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  title: string;
  detail: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-start justify-between gap-3">
        <SettingLabel title={title} detail={detail} />
        <output className="shrink-0 pt-0.5 text-xs font-semibold tabular-nums text-[var(--salt-primary)]">
          {value}
          {suffix}
        </output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={title}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-3 h-1.5 w-full cursor-pointer accent-[var(--salt-primary)]"
      />
    </label>
  );
}

export function SettingsDrawer({
  open,
  onClose,
  settings,
  onUpdate,
  onReset,
  localSongs,
  localLoading,
  localError,
  onImportFiles,
  onImportDesktopFiles,
  onImportBackgroundImage,
  onRemoveBackgroundImage,
  onRemoveLocalSong,
  onClearLocalSongs,
}: {
  open: boolean;
  onClose: () => void;
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
  onReset: () => void;
  localSongs: Song[];
  localLoading: boolean;
  localError: string | null;
  onImportFiles: (files: File[]) => Promise<void>;
  onImportDesktopFiles?: () => Promise<void>;
  onImportBackgroundImage?: (target: 'app' | 'player', file?: File) => Promise<void>;
  onRemoveBackgroundImage?: (target: 'app' | 'player') => Promise<void>;
  onRemoveLocalSong: (song: Song) => Promise<void>;
  onClearLocalSongs: () => Promise<void>;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const appBackgroundInputRef = useRef<HTMLInputElement>(null);
  const playerBackgroundInputRef = useRef<HTMLInputElement>(null);
  const autoplay = usePlayerStore((state) => state.autoplay);
  const toggleAutoplay = usePlayerStore((state) => state.toggleAutoplay);
  const playAlbum = usePlayerStore((state) => state.playAlbum);
  const desktopBridge = getDesktopBridge();

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const releaseScroll = lockBodyScroll();
    closeButtonRef.current?.focus();

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = focusableElements(dialogRef.current);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      releaseScroll();
      document.removeEventListener('keydown', onKeyDown);
      requestAnimationFrame(() => returnFocusRef.current?.focus());
    };
  }, [onClose, open]);

  if (!open) return null;

  const colorPickerValue = settings.accentColor.length === 9 ? settings.accentColor.slice(0, 7) : settings.accentColor;

  return (
    <div className="fixed inset-0 z-[110]" role="presentation">
      <button
        type="button"
        aria-label="Close settings"
        onClick={onClose}
        className="absolute inset-0 bg-[rgba(13,43,62,0.28)] backdrop-blur-[2px]"
      />
      <aside
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-drawer-title"
        className="marea-glass-panel absolute inset-y-0 right-0 flex w-full max-w-[460px] flex-col border-l"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--glass-border)] px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--salt-ghost)] text-[var(--salt-primary)]">
              <Paintbrush className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 id="settings-drawer-title" className="truncate text-[17px] font-bold text-[var(--salt-white)]">
                Settings
              </h2>
              <p className="mt-0.5 text-xs text-[var(--salt-mist)]">Personalize Marea and keep your library close.</p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            title="Close settings"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--salt-mist)] transition-colors hover:bg-[var(--glass-bg-hover)] hover:text-[var(--salt-white)]"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8">
          <section className="border-b border-[var(--glass-border)] py-5" aria-labelledby="settings-appearance">
            <h3
              id="settings-appearance"
              className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--salt-primary)]"
            >
              Appearance
            </h3>

            <div className="mt-3" role="radiogroup" aria-label="Theme">
              <p className="mb-2 text-[13px] font-semibold text-[var(--salt-white)]">Theme</p>
              <div className="grid grid-cols-3 gap-1 rounded-xl bg-[var(--salt-ghost)] p-1">
                {THEME_OPTIONS.map((option) => {
                  const selected = settings.theme === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => onUpdate({ theme: option.value })}
                      className={`flex min-h-[64px] min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1.5 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)] ${selected ? 'bg-white text-[var(--salt-primary)] shadow-sm' : 'text-[var(--salt-mist)] hover:text-[var(--salt-white)]'}`}
                    >
                      {option.icon}
                      <span className="block truncate text-[11px] font-bold">{option.label}</span>
                      <span className="block truncate text-[10px] opacity-75">{option.detail}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between gap-3">
                <SettingLabel title="Accent color" detail="Used for actions, progress, and focus states." />
                <button
                  type="button"
                  onClick={() => onUpdate({ accentColor: '#0d6fa8' })}
                  className="shrink-0 text-[11px] font-semibold text-[var(--salt-primary)] underline-offset-2 hover:underline"
                >
                  Reset
                </button>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <input
                  type="color"
                  value={colorPickerValue}
                  aria-label="Choose accent color"
                  onChange={(event) => onUpdate({ accentColor: event.target.value })}
                  className="h-10 w-12 cursor-pointer rounded-lg border border-[var(--glass-border)] bg-white p-1"
                />
                <input
                  type="text"
                  value={settings.accentColor}
                  aria-label="Accent color hex value"
                  onChange={(event) => {
                    if (isHexColor(event.target.value)) onUpdate({ accentColor: event.target.value });
                  }}
                  spellCheck={false}
                  className="h-10 min-w-0 flex-1 rounded-lg border border-[var(--glass-border)] bg-white px-3 font-mono text-xs text-[var(--salt-white)] outline-none transition-colors focus:border-[var(--salt-primary)] focus:ring-2 focus:ring-[var(--salt-primary)]/20"
                />
              </div>
            </div>

            <div className="mt-5">
              <p className="mb-2 text-[13px] font-semibold text-[var(--salt-white)]">Interface scale</p>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Interface scale">
                {FONT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={settings.fontScale === option.value}
                    onClick={() => onUpdate({ fontScale: option.value })}
                    className={`h-9 rounded-lg border text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)] ${settings.fontScale === option.value ? 'border-[var(--salt-primary)] bg-[var(--salt-ghost)] text-[var(--salt-primary)]' : 'border-[var(--glass-border)] text-[var(--salt-mist)] hover:bg-[var(--glass-bg-hover)]'}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <p className="mb-2 text-[13px] font-semibold text-[var(--salt-white)]">App background</p>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="App background">
                {APP_BACKGROUND_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={settings.appBackground === option.value}
                    onClick={() => onUpdate({ appBackground: option.value })}
                    className={`h-9 rounded-lg border text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)] ${settings.appBackground === option.value ? 'border-[var(--salt-primary)] bg-[var(--salt-ghost)] text-[var(--salt-primary)]' : 'border-[var(--glass-border)] text-[var(--salt-mist)] hover:bg-[var(--glass-bg-hover)]'}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-3 rounded-xl border border-[var(--glass-border)] bg-[var(--salt-ghost)] px-3 py-2.5">
                {settings.appBackgroundImage ? (
                  <span
                    aria-hidden
                    className="h-10 w-10 shrink-0 rounded-lg border border-[var(--glass-border)] bg-cover bg-center"
                    style={{ backgroundImage: `url("${settings.appBackgroundImage}")` }}
                  />
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-[var(--salt-mist)]">
                    <Paintbrush className="h-4 w-4" aria-hidden />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <SettingLabel
                    title="Custom app image"
                    detail={
                      desktopBridge
                        ? 'Copied into Marea storage on desktop.'
                        : 'Choose an image for this browser session.'
                    }
                  />
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <input
                    ref={appBackgroundInputRef}
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.currentTarget.value = '';
                      if (file) void onImportBackgroundImage?.('app', file);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (desktopBridge) void onImportBackgroundImage?.('app');
                      else appBackgroundInputRef.current?.click();
                    }}
                    title="Import app background image"
                    className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--salt-primary)] px-2.5 text-[11px] font-semibold text-white transition-colors hover:bg-[var(--salt-bright)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
                  >
                    <Upload className="h-3.5 w-3.5" aria-hidden />
                    Import
                  </button>
                  {settings.appBackgroundImage && (
                    <button
                      type="button"
                      onClick={() => void onRemoveBackgroundImage?.('app')}
                      aria-label="Remove app background image"
                      title="Remove app background image"
                      className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--salt-mist)] transition-colors hover:bg-[var(--glass-bg-hover)] hover:text-[var(--danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-5">
              <p className="mb-2 text-[13px] font-semibold text-[var(--salt-white)]">Player background</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Player background">
                {BACKGROUND_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={settings.background === option.value}
                    onClick={() => onUpdate({ background: option.value })}
                    className={`h-9 rounded-lg border text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)] ${settings.background === option.value ? 'border-[var(--salt-primary)] bg-[var(--salt-ghost)] text-[var(--salt-primary)]' : 'border-[var(--glass-border)] text-[var(--salt-mist)] hover:bg-[var(--glass-bg-hover)]'}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-3 rounded-xl border border-[var(--glass-border)] bg-[var(--salt-ghost)] px-3 py-2.5">
                {settings.playerBackgroundImage ? (
                  <span
                    aria-hidden
                    className="h-10 w-10 shrink-0 rounded-lg border border-[var(--glass-border)] bg-cover bg-center"
                    style={{ backgroundImage: `url("${settings.playerBackgroundImage}")` }}
                  />
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-[var(--salt-mist)]">
                    <Paintbrush className="h-4 w-4" aria-hidden />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <SettingLabel
                    title="Custom player image"
                    detail={desktopBridge ? 'Used only behind the full player.' : 'Used for this browser session only.'}
                  />
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <input
                    ref={playerBackgroundInputRef}
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.currentTarget.value = '';
                      if (file) void onImportBackgroundImage?.('player', file);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (desktopBridge) void onImportBackgroundImage?.('player');
                      else playerBackgroundInputRef.current?.click();
                    }}
                    title="Import player background image"
                    className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--salt-primary)] px-2.5 text-[11px] font-semibold text-white transition-colors hover:bg-[var(--salt-bright)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
                  >
                    <Upload className="h-3.5 w-3.5" aria-hidden />
                    Import
                  </button>
                  {settings.playerBackgroundImage && (
                    <button
                      type="button"
                      onClick={() => void onRemoveBackgroundImage?.('player')}
                      aria-label="Remove player background image"
                      title="Remove player background image"
                      className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--salt-mist)] transition-colors hover:bg-[var(--glass-bg-hover)] hover:text-[var(--danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-5 space-y-4 rounded-xl border border-[var(--glass-border)] bg-[var(--salt-ghost)] px-3 py-3">
              <RangeSetting
                title="Atmosphere opacity"
                detail="Keep the artwork present without competing with the controls."
                value={Math.round(settings.backgroundOpacity * 100)}
                min={0}
                max={100}
                step={5}
                suffix="%"
                onChange={(value) => onUpdate({ backgroundOpacity: value / 100 })}
              />
              <RangeSetting
                title="Atmosphere blur"
                detail="Soften the cover wash behind the player."
                value={settings.backgroundBlur}
                min={0}
                max={180}
                step={5}
                suffix="px"
                onChange={(backgroundBlur) => onUpdate({ backgroundBlur })}
              />
              <RangeSetting
                title="Brightness"
                detail="Keep text contrast comfortable in the player."
                value={Math.round(settings.backgroundBrightness * 100)}
                min={60}
                max={140}
                step={5}
                suffix="%"
                onChange={(value) => onUpdate({ backgroundBrightness: value / 100 })}
              />
              <RangeSetting
                title="Saturation"
                detail="Control how strongly cover colors tint the surface."
                value={Math.round(settings.backgroundSaturation * 100)}
                min={50}
                max={180}
                step={5}
                suffix="%"
                onChange={(value) => onUpdate({ backgroundSaturation: value / 100 })}
              />
            </div>

            <div className="mt-2 divide-y divide-[var(--glass-border)]">
              <ToggleRow
                checked={settings.reducedMotion}
                onChange={(reducedMotion) => onUpdate({ reducedMotion })}
                title="Reduce motion"
                detail="Keep transitions quiet and predictable."
              />
            </div>

            <div className="mt-5 border-t border-[var(--glass-border)] pt-5">
              <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--salt-primary)]">Layout</h3>
              <div className="mt-3 space-y-4">
                <label className="flex items-center justify-between gap-4">
                  <SettingLabel title="Sidebar" detail="Keep labels visible or make room for the catalog." />
                  <select
                    value={settings.sidebarMode}
                    onChange={(event) => onUpdate({ sidebarMode: event.target.value as SidebarMode })}
                    className="h-9 max-w-[150px] rounded-lg border border-[var(--glass-border)] bg-white px-2 text-xs font-semibold text-[var(--salt-white)] outline-none focus:border-[var(--salt-primary)] focus:ring-2 focus:ring-[var(--salt-primary)]/20"
                  >
                    {SIDEBAR_MODE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center justify-between gap-4">
                  <SettingLabel
                    title="Queue panel"
                    detail="Choose the amount of playback order shown beside browsing."
                  />
                  <select
                    value={settings.queuePanelMode}
                    onChange={(event) => onUpdate({ queuePanelMode: event.target.value as QueuePanelMode })}
                    className="h-9 max-w-[150px] rounded-lg border border-[var(--glass-border)] bg-white px-2 text-xs font-semibold text-[var(--salt-white)] outline-none focus:border-[var(--salt-primary)] focus:ring-2 focus:ring-[var(--salt-primary)]/20"
                  >
                    {QUEUE_MODE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="mt-5 border-t border-[var(--glass-border)] pt-5">
              <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--salt-primary)]">
                Typography
              </h3>
              <div className="mt-3 space-y-4">
                <label className="flex items-center justify-between gap-4">
                  <SettingLabel title="Font family" detail="Preview the reading voice across the app." />
                  <select
                    value={settings.fontFamily}
                    onChange={(event) => onUpdate({ fontFamily: event.target.value as FontFamily })}
                    className="h-9 max-w-[150px] rounded-lg border border-[var(--glass-border)] bg-white px-2 text-xs font-semibold text-[var(--salt-white)] outline-none focus:border-[var(--salt-primary)] focus:ring-2 focus:ring-[var(--salt-primary)]/20"
                  >
                    {FONT_FAMILY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex items-center justify-between gap-4">
                  <SettingLabel title="Interface weight" detail="Balance density and hierarchy." />
                  <select
                    value={settings.fontWeight}
                    onChange={(event) => onUpdate({ fontWeight: event.target.value as FontWeight })}
                    className="h-9 max-w-[150px] rounded-lg border border-[var(--glass-border)] bg-white px-2 text-xs font-semibold text-[var(--salt-white)] outline-none focus:border-[var(--salt-primary)] focus:ring-2 focus:ring-[var(--salt-primary)]/20"
                  >
                    {FONT_WEIGHT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div>
                  <p className="mb-2 text-[13px] font-semibold text-[var(--salt-white)]">Lyric size</p>
                  <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Lyric size">
                    {LYRIC_SCALE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={settings.lyricScale === option.value}
                        onClick={() => onUpdate({ lyricScale: option.value })}
                        className={`h-9 rounded-lg border text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)] ${settings.lyricScale === option.value ? 'border-[var(--salt-primary)] bg-[var(--salt-ghost)] text-[var(--salt-primary)]' : 'border-[var(--glass-border)] text-[var(--salt-mist)] hover:bg-[var(--glass-bg-hover)]'}`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-[13px] font-semibold text-[var(--salt-white)]">Text spacing</p>
                  <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Text spacing">
                    {LETTER_SPACING_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={settings.letterSpacing === option.value}
                        onClick={() => onUpdate({ letterSpacing: option.value })}
                        className={`h-9 rounded-lg border text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)] ${settings.letterSpacing === option.value ? 'border-[var(--salt-primary)] bg-[var(--salt-ghost)] text-[var(--salt-primary)]' : 'border-[var(--glass-border)] text-[var(--salt-mist)] hover:bg-[var(--glass-bg-hover)]'}`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div
                  aria-label="Typography preview"
                  className="overflow-hidden rounded-xl border border-[var(--glass-border)] bg-white px-4 py-4"
                >
                  <p
                    className="text-[18px] text-[var(--salt-white)]"
                    style={{
                      fontFamily: fontFamilyValue(settings.fontFamily),
                      fontSize: `calc(18px * ${fontScaleValue(settings.fontScale)})`,
                      fontWeight: fontWeightValue(settings.fontWeight),
                      letterSpacing: letterSpacingValue(settings.letterSpacing),
                    }}
                  >
                    Marea / Ocean cadence
                  </p>
                  <p
                    className="mt-2 leading-relaxed text-[var(--salt-mist)]"
                    style={{
                      fontFamily: fontFamilyValue(settings.fontFamily),
                      fontSize: `calc(15px * ${lyricScaleValue(settings.lyricScale)})`,
                      fontWeight: fontWeightValue(settings.fontWeight),
                      letterSpacing: letterSpacingValue(settings.letterSpacing),
                    }}
                  >
                    A calm interface for long listening sessions, with enough contrast for lyrics and queue details.
                  </p>
                  <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--salt-primary)]">
                    Preview updates instantly
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="border-b border-[var(--glass-border)] py-5" aria-labelledby="settings-playback">
            <h3
              id="settings-playback"
              className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--salt-primary)]"
            >
              Playback
            </h3>
            <div className="mt-2 divide-y divide-[var(--glass-border)]">
              <ToggleRow
                checked={autoplay}
                onChange={toggleAutoplay}
                title="Autoplay recommendations"
                detail="Continue with a verified related track when the queue ends."
              />
            </div>
          </section>

          <section className="py-5" aria-labelledby="settings-local-music">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3
                  id="settings-local-music"
                  className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--salt-primary)]"
                >
                  Local music
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-[var(--salt-mist)]">
                  Files stay in this browser profile and use the same queue and transport controls as online tracks.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--salt-primary)] px-3 text-xs font-semibold text-white transition-colors hover:bg-[var(--salt-bright)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden />
                  Import audio
                </button>
                {desktopBridge && onImportDesktopFiles && (
                  <button
                    type="button"
                    onClick={() => void onImportDesktopFiles()}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--glass-border)] px-3 text-xs font-semibold text-[var(--salt-primary)] transition-colors hover:bg-[var(--glass-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
                  >
                    Desktop files
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,.flac"
                multiple
                className="sr-only"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.currentTarget.value = '';
                  if (files.length > 0) void onImportFiles(files);
                }}
              />
            </div>

            {localError && (
              <p className="mt-3 text-xs text-[#8a5b00]" role="status">
                {localError}
              </p>
            )}
            {localLoading ? (
              <p className="mt-4 text-xs text-[var(--salt-mist)]">Opening local library...</p>
            ) : localSongs.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-[var(--glass-border)] px-4 py-5 text-center">
                <Sparkles className="mx-auto h-5 w-5 text-[var(--salt-mist)]" aria-hidden />
                <p className="mt-2 text-xs font-semibold text-[var(--salt-white)]">No local tracks yet</p>
                <p className="mt-1 text-[11px] text-[var(--salt-mist)]">Import audio to build a private library.</p>
              </div>
            ) : (
              <>
                <div className="mt-4 flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-[var(--salt-white)]">
                    {localSongs.length} {localSongs.length === 1 ? 'track' : 'tracks'}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => playAlbum(localSongs, 0)}
                      className="marea-primary-action inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold text-white"
                    >
                      <Play className="h-3.5 w-3.5" aria-hidden />
                      Play all
                    </button>
                    <button
                      type="button"
                      onClick={() => void onClearLocalSongs()}
                      aria-label="Clear local music"
                      title="Clear local music"
                      className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--salt-mist)] transition-colors hover:bg-[var(--glass-bg-hover)] hover:text-[var(--danger)]"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                </div>
                <VirtualList
                  items={localSongs}
                  estimateSize={50}
                  overscan={6}
                  label="Local music"
                  getItemKey={(song) => song.id}
                  className="mt-2 rounded-xl border border-[var(--glass-border)] bg-white"
                  renderItem={(song) => (
                    <div className="flex items-center gap-2 border-b border-[var(--glass-border)] px-2.5 py-2">
                      <CoverArt
                        src={song.coverArt}
                        alt=""
                        sizes="32px"
                        className="h-8 w-8 shrink-0 rounded object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => playAlbum([song], 0)}
                        className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
                      >
                        <span className="block truncate text-xs font-semibold text-[var(--salt-white)]">
                          {song.title}
                        </span>
                        <span className="mt-0.5 block truncate text-[10px] text-[var(--salt-mist)]">
                          {formatDuration(song.duration)}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void onRemoveLocalSong(song)}
                        aria-label={`Remove ${song.title}`}
                        title="Remove local track"
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--salt-mist)] hover:bg-[var(--glass-bg-hover)] hover:text-[var(--danger)]"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                  )}
                />
              </>
            )}
          </section>

          <div className="flex items-center justify-between gap-3 border-t border-[var(--glass-border)] pt-4">
            <p className="text-[11px] text-[var(--salt-mist)]">Preferences are saved on this device.</p>
            <button
              type="button"
              onClick={onReset}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--glass-border)] px-3 text-[11px] font-semibold text-[var(--salt-primary)] transition-colors hover:bg-[var(--glass-bg-hover)]"
            >
              <Check className="h-3.5 w-3.5" aria-hidden />
              Reset settings
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
