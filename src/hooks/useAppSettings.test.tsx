/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { useAppSettings } from './useAppSettings';

let latest: ReturnType<typeof useAppSettings> | null = null;

function Probe() {
  const settings = useAppSettings();
  useEffect(() => {
    latest = settings;
  }, [settings]);
  return null;
}

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

afterEach(() => {
  latest = null;
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('useAppSettings', () => {
  it('drops stale browser-only background URLs while hydrating persisted settings', async () => {
    window.localStorage.setItem(
      'marea-settings-v1',
      JSON.stringify({
        appBackground: 'image',
        appBackgroundImage: 'blob:http://localhost/stale-app',
        background: 'image',
        playerBackgroundImage: 'blob:http://localhost/stale-player',
      }),
    );

    render(<Probe />);

    await waitFor(() => expect(latest?.hydrated).toBe(true));
    expect(latest?.settings.appBackground).toBe('ocean');
    expect(latest?.settings.appBackgroundImage).toBeNull();
    expect(latest?.settings.background).toBe('wash');
    expect(latest?.settings.playerBackgroundImage).toBeNull();
  });

  it('revokes replaced and unmounted browser background URLs', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const view = render(<Probe />);

    await waitFor(() => expect(latest?.hydrated).toBe(true));
    act(() => {
      latest!.updateSettings({
        appBackground: 'image',
        appBackgroundImage: 'blob:marea-app-old',
        background: 'image',
        playerBackgroundImage: 'blob:marea-player-old',
      });
    });
    act(() => {
      latest!.updateSettings({ appBackgroundImage: 'blob:marea-app-new' });
    });

    expect(revoke).toHaveBeenCalledWith('blob:marea-app-old');
    expect(revoke).not.toHaveBeenCalledWith('blob:marea-player-old');

    view.unmount();

    expect(revoke).toHaveBeenCalledWith('blob:marea-app-new');
    expect(revoke).toHaveBeenCalledWith('blob:marea-player-old');
  });
});
