/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect, useState } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { PlayerStoreProvider, usePlayerStoreApi, type PlayerStore } from '@/store/playerStore';
import { lockBodyScroll, resetBodyScrollLock } from '@/lib/scrollLock';
import { AddToPlaylistDialog } from './AddToPlaylistDialog';
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
const onClose = vi.fn();

function Probe() {
  const api = usePlayerStoreApi();
  useEffect(() => {
    store = api;
  }, [api]);
  return null;
}

/** An opener button, so focus restoration has somewhere real to go back to. */
function Host() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Probe />
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <AddToPlaylistDialog
          song={song('a')}
          onClose={() => {
            onClose();
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function mount() {
  return render(
    <PlayerStoreProvider initialView="albums" initialQuery="">
      <Host />
    </PlayerStoreProvider>,
  );
}

let user: UserEvent;

beforeEach(() => {
  window.localStorage.clear();
  resetBodyScrollLock();
  onClose.mockReset();
  user = userEvent.setup();
});

afterEach(() => {
  resetBodyScrollLock();
});

async function open(): Promise<HTMLDialogElement> {
  await user.click(screen.getByRole('button', { name: 'Open' }));
  return screen.getByRole('dialog') as HTMLDialogElement;
}

describe('modality', () => {
  it('opens as a modal dialog rather than a div wearing the role', async () => {
    mount();
    const dialog = await open();

    // `showModal` is what makes the rest of the page inert; a hand-rolled trap
    // moves focus but leaves the background reachable to a screen reader.
    expect(dialog.tagName).toBe('DIALOG');
    expect(dialog.open).toBe(true);
    expect(dialog).toHaveAccessibleName('Add to playlist');
  });

  it('focuses the name field on open and restores focus to the opener on close', async () => {
    mount();
    const opener = screen.getByRole('button', { name: 'Open' });
    await open();

    expect(screen.getByLabelText('New playlist name')).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalled();
    expect(opener).toHaveFocus();
  });

  it('closes on Escape', async () => {
    mount();
    await open();

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('body scroll lock', () => {
  it('locks while open and releases on close', async () => {
    mount();
    await open();
    expect(document.body.style.overflow).toBe('hidden');

    await user.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('');
  });

  it('stays locked while another holder still needs it', async () => {
    // The nesting case the old save/restore got wrong: an outer holder locks,
    // the dialog locks and unlocks, and the page used to start scrolling again
    // underneath the thing still on screen.
    const releaseOuter = lockBodyScroll();
    mount();
    await open();
    await user.keyboard('{Escape}');

    expect(document.body.style.overflow).toBe('hidden');

    releaseOuter();
    expect(document.body.style.overflow).toBe('');
  });
});

describe('playlist membership', () => {
  it('creates a playlist with the track already in it', async () => {
    mount();
    await open();

    await user.type(screen.getByLabelText('New playlist name'), 'Road trip');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    const [playlist] = store.getState().playlists;
    expect(playlist).toMatchObject({ name: 'Road trip' });
    expect(playlist.songs.map((item) => item.id)).toEqual(['a']);
    // Creating is a complete answer to "add to playlist", so it closes.
    expect(onClose).toHaveBeenCalled();
  });

  it('refuses a blank name instead of creating an untitled playlist', async () => {
    mount();
    await open();

    await user.type(screen.getByLabelText('New playlist name'), '   ');

    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    expect(store.getState().playlists).toEqual([]);
  });

  it('toggles membership of an existing playlist and shows it as pressed', async () => {
    mount();
    await open();
    // Seed through the store so the row starts unchecked.
    await user.keyboard('{Escape}');
    store.getState().createPlaylist('Focus');
    await open();

    const row = screen.getByRole('button', { name: /Focus/ });
    expect(row).toHaveAttribute('aria-pressed', 'false');

    await user.click(row);
    expect(store.getState().playlists[0].songs.map((item) => item.id)).toEqual(['a']);
    expect(screen.getByRole('button', { name: /Focus/ })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: /Focus/ }));
    expect(store.getState().playlists[0].songs).toEqual([]);
  });

  it('keeps a large playlist picker bounded to its initial render window', async () => {
    mount();
    act(() => {
      for (let index = 0; index < 500; index += 1) {
        store.getState().createPlaylist(`Playlist ${index}`);
      }
    });
    await open();

    const list = screen.getByRole('list', { name: 'Playlists' });
    expect(list.querySelectorAll('[role="listitem"]').length).toBeLessThanOrEqual(12);
    expect(screen.getByRole('button', { name: /Playlist 499/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Playlist 0/ })).not.toBeInTheDocument();
  });
});
