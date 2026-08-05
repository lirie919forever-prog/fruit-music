/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect, useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { QueueDrawer } from './QueueDrawer';
import { PlayerStoreProvider, usePlayerStoreApi, type PlayerStore } from '@/store/playerStore';
import { lockBodyScroll, resetBodyScrollLock } from '@/lib/scrollLock';
import type { Song } from '@/types/music';

function song(id: string): Song {
  return {
    id,
    title: `Title ${id}`,
    artist: 'Artist',
    artistId: 'artist-1',
    album: 'Album',
    albumId: 'album-1',
    coverArt: '/placeholder-album.svg',
    duration: 100,
    track: 1,
    year: 2026,
    genre: 'Test',
    path: `/stream/${id}`,
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
let user: UserEvent;
const onClose = vi.fn();
const onOpenFullPlayer = vi.fn();

function Probe() {
  const api = usePlayerStoreApi();
  useEffect(() => {
    store = api;
  }, [api]);
  return null;
}

function Host() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Probe />
      <button type="button" onClick={() => setOpen(true)}>
        Open queue
      </button>
      <QueueDrawer
        open={open}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        onOpenFullPlayer={onOpenFullPlayer}
      />
    </>
  );
}

function mount() {
  const result = render(
    <PlayerStoreProvider initialView="albums" initialQuery="">
      <Host />
    </PlayerStoreProvider>,
  );
  store.getState().setQueue([song('a'), song('b'), song('c')]);
  return result;
}

async function openDrawer() {
  await user.click(screen.getByRole('button', { name: 'Open queue' }));
  return screen.getByRole('dialog');
}

beforeEach(() => {
  window.localStorage.clear();
  resetBodyScrollLock();
  onClose.mockReset();
  onOpenFullPlayer.mockReset();
  user = userEvent.setup();
});

afterEach(() => {
  resetBodyScrollLock();
});

describe('QueueDrawer modality', () => {
  it('locks scrolling, focuses its close control, and restores the opener on Escape', async () => {
    mount();
    const opener = screen.getByRole('button', { name: 'Open queue' });

    await openDrawer();

    expect(document.body.style.overflow).toBe('hidden');
    expect(screen.getAllByRole('button', { name: 'Close queue' })[1]).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
    expect(document.body.style.overflow).toBe('');
  });

  it('does not release an outer scroll lock when the drawer closes', async () => {
    const releaseOuter = lockBodyScroll();
    mount();

    await openDrawer();
    await user.keyboard('{Escape}');

    expect(document.body.style.overflow).toBe('hidden');
    releaseOuter();
    expect(document.body.style.overflow).toBe('');
  });
});

describe('QueueDrawer actions', () => {
  it('reorders, removes, plays, toggles autoplay, clears, and opens the full player', async () => {
    mount();
    const dialog = await openDrawer();
    const list = within(dialog).getByRole('list', { name: 'Playback queue' });

    await user.click(within(list).getByRole('button', { name: 'Move Title b earlier' }));
    expect(store.getState().queue.map((item) => item.song.id)).toEqual(['b', 'a', 'c']);

    await user.click(within(list).getByRole('button', { name: 'Remove Title b from queue' }));
    expect(store.getState().queue.map((item) => item.song.id)).toEqual(['a', 'c']);

    await user.click(within(list).getByRole('button', { name: 'Play Title c by Artist' }));
    expect(store.getState().currentSong?.id).toBe('c');
    expect(store.getState().queueIndex).toBe(1);

    const autoplay = within(dialog).getByRole('button', { name: 'Autoplay on' });
    await user.click(autoplay);
    expect(autoplay).toHaveAttribute('aria-pressed', 'false');

    await user.click(within(dialog).getByRole('button', { name: 'Open full player' }));
    expect(onOpenFullPlayer).toHaveBeenCalledOnce();

    await user.click(within(dialog).getByRole('button', { name: 'Clear' }));
    // Clear removes the upcoming tracks but preserves the one already playing.
    expect(store.getState().queue.map((item) => item.song.id)).toEqual(['c']);
    expect(store.getState().currentSong?.id).toBe('c');
  });
});
