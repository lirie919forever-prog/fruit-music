'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  APP_SETTINGS_KEY,
  DEFAULT_APP_SETTINGS,
  fontFamilyValue,
  fontScaleValue,
  fontWeightValue,
  letterSpacingValue,
  lyricScaleValue,
  preparePersistedAppSettings,
  resolveAppTheme,
  sanitizeAppSettings,
  type AppSettings,
} from '@/lib/appSettings';
import { getDesktopBridge } from '@/lib/desktopBridge';

export const SETTINGS_PERSIST_DEBOUNCE_MS = 600;

function revokeBrowserImage(url: string | null): void {
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
}

export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [hydrated, setHydrated] = useState(false);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    let active = true;
    const bridge = getDesktopBridge();

    const hydrate = async () => {
      let stored: unknown = null;
      try {
        // Desktop settings live in Electron userData so a renderer reset or
        // browser storage cleanup cannot discard the user's visual setup.
        stored = bridge ? await bridge.loadSettings() : null;
      } catch {
        // Fall through to the browser store when the optional desktop bridge is unavailable.
      }
      if (!stored) {
        try {
          const local = window.localStorage.getItem(APP_SETTINGS_KEY);
          if (local) stored = JSON.parse(local);
        } catch {
          // A blocked or malformed preference must never prevent the app from opening.
        }
      }
      if (!active) return;
      if (stored) {
        // A blob URL is valid for the current browser session only. Normalize
        // persisted data through the same file-capability filter used before
        // writes so a stale browser URL cannot become a broken background on
        // the next reload.
        setSettings(preparePersistedAppSettings(sanitizeAppSettings(stored)));
      }
      setHydrated(true);
    };

    void hydrate();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;

    const persist = () => {
      persistTimerRef.current = null;
      const persistable = preparePersistedAppSettings(settings);
      try {
        window.localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(persistable));
      } catch {
        // The in-memory preference remains valid when storage is unavailable.
      }
      const bridge = getDesktopBridge();
      if (bridge) void bridge.saveSettings(persistable).catch(() => undefined);
    };

    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(persist, SETTINGS_PERSIST_DEBOUNCE_MS);
    window.addEventListener('pagehide', persist);
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
      window.removeEventListener('pagehide', persist);
    };
  }, [hydrated, settings]);

  useEffect(() => {
    const root = document.documentElement;
    const apply = (prefersDark: boolean) => {
      root.dataset.mareaTheme = resolveAppTheme(settings.theme, prefersDark);
      root.dataset.mareaThemeMode = settings.theme;
      root.dataset.mareaBackground = settings.background;
      if (settings.reducedMotion) root.dataset.mareaReducedMotion = 'true';
      else delete root.dataset.mareaReducedMotion;
      root.style.setProperty('--marea-font-scale', fontScaleValue(settings.fontScale));
      root.style.setProperty('--marea-font-family', fontFamilyValue(settings.fontFamily));
      root.style.setProperty('--marea-font-weight', fontWeightValue(settings.fontWeight));
      root.style.setProperty('--marea-lyric-scale', lyricScaleValue(settings.lyricScale));
      root.style.setProperty('--marea-letter-spacing', letterSpacingValue(settings.letterSpacing));
      root.style.setProperty('--marea-accent', settings.accentColor);
      root.style.setProperty('--marea-background-opacity', String(settings.backgroundOpacity));
      root.style.setProperty('--marea-background-blur', `${settings.backgroundBlur}px`);
      root.style.setProperty('--marea-background-brightness', String(settings.backgroundBrightness));
      root.style.setProperty('--marea-background-saturation', `${settings.backgroundSaturation * 100}%`);
      root.style.setProperty('--salt-primary', settings.accentColor);
    };

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    apply(media.matches);
    if (settings.theme !== 'system') return;

    const onChange = (event: MediaQueryListEvent) => apply(event.matches);
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, [settings]);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((current) => {
      const next = sanitizeAppSettings({ ...current, ...patch });
      if (next.appBackgroundImage !== current.appBackgroundImage) {
        revokeBrowserImage(current.appBackgroundImage);
      }
      if (next.playerBackgroundImage !== current.playerBackgroundImage) {
        revokeBrowserImage(current.playerBackgroundImage);
      }
      return next;
    });
  }, []);

  const resetSettings = useCallback(() => {
    setSettings((current) => {
      revokeBrowserImage(current.appBackgroundImage);
      revokeBrowserImage(current.playerBackgroundImage);
      return DEFAULT_APP_SETTINGS;
    });
  }, []);

  useEffect(
    () => () => {
      revokeBrowserImage(settingsRef.current.appBackgroundImage);
      revokeBrowserImage(settingsRef.current.playerBackgroundImage);
    },
    [],
  );

  return { settings, updateSettings, resetSettings, hydrated };
}
