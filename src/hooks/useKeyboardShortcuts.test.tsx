/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { PlayerStoreProvider, usePlayerStoreApi, type PlayerStore } from '@/store/playerStore';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import type { Song } from '@/types/music';

function song(): Song {
  return {
    id: 'shortcut-song',
    title: 'Shortcut song',
    artist: 'Marea test',
    artistId: 'artist',
    album: 'Test album',
    albumId: 'album',
    coverArt: '/placeholder-album.svg',
    duration: 120,
    track: 1,
    year: 2026,
    genre: 'Test',
    path: '/test.mp3',
    bitRate: 0,
    contentType: 'audio/mpeg',
    suffix: 'mp3',
    size: 1,
    provider: 'Jamendo',
    sourceUrl: '',
    creatorUrl: '',
    licenseName: 'CC BY',
    licenseUrl: '',
    attributionUrl: '',
    metadataVerified: true,
  };
}

let store: PlayerStore;

function Probe() {
  const api = usePlayerStoreApi();
  useEffect(() => {
    store = api;
  }, [api]);
  return null;
}

function Host({ actions }: { actions: Parameters<typeof useKeyboardShortcuts>[0] }) {
  useKeyboardShortcuts(actions);
  return (
    <>
      <Probe />
      <input aria-label="Editable field" />
      <button type="button" aria-label="Control target">
        Control target
      </button>
    </>
  );
}

function mount(actions: Parameters<typeof useKeyboardShortcuts>[0]) {
  render(
    <PlayerStoreProvider initialView="albums" initialQuery="">
      <Host actions={actions} />
    </PlayerStoreProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('keyboard shortcuts', () => {
  it('routes command shortcuts to shell actions', () => {
    const actions = {
      seek: vi.fn(),
      importLocalAudio: vi.fn(),
      toggleLyrics: vi.fn(),
      toggleQueue: vi.fn(),
      openSettings: vi.fn(),
      toggleFullscreenLyrics: vi.fn(),
      toggleTheme: vi.fn(),
    };
    mount(actions);

    fireEvent.keyDown(document, { key: 'o', ctrlKey: true });
    fireEvent.keyDown(document, { key: 'l', metaKey: true });
    fireEvent.keyDown(document, { key: 'q', ctrlKey: true });
    fireEvent.keyDown(document, { key: ',', metaKey: true });
    fireEvent.keyDown(document, { key: 'f' });
    fireEvent.keyDown(document, { key: 't' });

    expect(actions.importLocalAudio).toHaveBeenCalledOnce();
    expect(actions.toggleLyrics).toHaveBeenCalledOnce();
    expect(actions.toggleQueue).toHaveBeenCalledOnce();
    expect(actions.openSettings).toHaveBeenCalledOnce();
    expect(actions.toggleFullscreenLyrics).toHaveBeenCalledOnce();
    expect(actions.toggleTheme).toHaveBeenCalledOnce();
  });

  it('uses five-second and five-percent transport increments', () => {
    const seek = vi.fn();
    mount({ seek });
    store.getState().setQueue([song()]);
    store.getState().setDuration(120);
    store.getState().setProgress(40);

    fireEvent.keyDown(document, { key: 'ArrowRight' });
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    fireEvent.keyDown(document, { key: 'ArrowDown' });

    expect(seek).toHaveBeenNthCalledWith(1, 45);
    expect(seek).toHaveBeenNthCalledWith(2, 35);
    expect(store.getState().volume).toBeCloseTo(0.7);
  });

  it('supports mute and ignores shortcuts from editable controls', () => {
    const toggleLyrics = vi.fn();
    mount({ seek: vi.fn(), toggleLyrics });
    const input = screen.getByRole('textbox', { name: 'Editable field' });
    const control = screen.getByRole('button', { name: 'Control target' });

    fireEvent.keyDown(input, { key: 'l', ctrlKey: true });
    expect(toggleLyrics).not.toHaveBeenCalled();
    fireEvent.keyDown(control, { key: 'l', ctrlKey: true });
    expect(toggleLyrics).toHaveBeenCalledOnce();

    expect(store.getState().volume).toBe(0.7);
    fireEvent.keyDown(document, { key: 'm' });
    expect(store.getState().volume).toBe(0);
    fireEvent.keyDown(document, { key: 'm' });
    expect(store.getState().volume).toBe(0.7);
  });
});
