/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { PlayerStoreProvider, usePlayerStoreApi, type PlayerStore } from '@/store/playerStore';
import { PlaylistsView } from './PlaylistsView';
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

function Probe() {
  const api = usePlayerStoreApi();
  useEffect(() => {
    store = api;
  }, [api]);
  return null;
}

function mount() {
  return render(
    <PlayerStoreProvider initialView="playlist" initialQuery="">
      <Probe />
      <PlaylistsView />
    </PlayerStoreProvider>,
  );
}

let user: UserEvent;

beforeEach(() => {
  window.localStorage.clear();
  user = userEvent.setup();
});

async function openPlaylist(name: string): Promise<void> {
  await user.click(screen.getByRole('button', { name: `Open playlist ${name}` }));
}

describe('creating', () => {
  it('creates a playlist and opens it, so the next step is adding tracks', async () => {
    mount();

    await user.type(screen.getByPlaceholderText('New playlist name'), 'Road trip');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(store.getState().playlists.map((item) => item.name)).toEqual(['Road trip']);
    // Naming a playlist is never the goal in itself, so creating lands on the
    // new playlist rather than back at a list with one more row.
    expect(screen.getByRole('heading', { name: 'Road trip' })).toBeInTheDocument();
  });

  it('creates on Enter as well as on the button', async () => {
    mount();

    await user.type(screen.getByPlaceholderText('New playlist name'), 'Focus{Enter}');

    expect(store.getState().playlists.map((item) => item.name)).toEqual(['Focus']);
  });

  it('will not create an untitled playlist', async () => {
    mount();

    await user.type(screen.getByPlaceholderText('New playlist name'), '   ');

    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    expect(store.getState().playlists).toEqual([]);
  });

  it('clears the field so the next name does not start from the last one', async () => {
    mount();

    await user.type(screen.getByPlaceholderText('New playlist name'), 'First{Enter}');
    // Creating opens the new playlist, so getting back to the field means
    // going back — which is where a stale value would show up.
    await user.click(screen.getByRole('button', { name: 'All playlists' }));

    expect(screen.getByPlaceholderText('New playlist name')).toHaveValue('');
  });
});

describe('renaming', () => {
  it('renames from the detail header', async () => {
    mount();
    act(() => {
      store.getState().createPlaylist('Old name', [song('a')]);
    });
    await openPlaylist('Old name');

    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const field = screen.getByLabelText(/playlist name/i);
    await user.clear(field);
    await user.type(field, 'New name');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(store.getState().playlists[0].name).toBe('New name');
    expect(screen.getByRole('heading', { name: 'New name' })).toBeInTheDocument();
  });

  it('abandons a rename on Escape and keeps the original name', async () => {
    mount();
    act(() => {
      store.getState().createPlaylist('Keep me', [song('a')]);
    });
    await openPlaylist('Keep me');

    await user.click(screen.getByRole('button', { name: 'Rename' }));
    await user.clear(screen.getByLabelText(/playlist name/i));
    await user.type(screen.getByLabelText(/playlist name/i), 'Discarded{Escape}');

    expect(store.getState().playlists[0].name).toBe('Keep me');
    expect(screen.getByRole('heading', { name: 'Keep me' })).toBeInTheDocument();
  });

  it('refuses a blank rename rather than leaving a nameless playlist', async () => {
    mount();
    act(() => {
      store.getState().createPlaylist('Named', [song('a')]);
    });
    await openPlaylist('Named');

    await user.click(screen.getByRole('button', { name: 'Rename' }));
    await user.clear(screen.getByLabelText(/playlist name/i));
    await user.type(screen.getByLabelText(/playlist name/i), '   {Enter}');

    expect(store.getState().playlists[0].name).toBe('Named');
  });
});

describe('deleting', () => {
  it('asks before deleting, and does nothing if the answer is no', async () => {
    mount();
    act(() => {
      store.getState().createPlaylist('Fragile', [song('a')]);
    });
    await openPlaylist('Fragile');

    await user.click(screen.getByRole('button', { name: /Delete/ }));
    expect(screen.getByText('Delete this playlist?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(store.getState().playlists).toHaveLength(1);
  });

  it('deletes on confirmation and returns to the list', async () => {
    mount();
    act(() => {
      store.getState().createPlaylist('Doomed', [song('a')]);
    });
    await openPlaylist('Doomed');

    await user.click(screen.getByRole('button', { name: /Delete/ }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(store.getState().playlists).toEqual([]);
    // Back on the list, not stranded on a detail page for something gone.
    expect(screen.getByPlaceholderText('New playlist name')).toBeInTheDocument();
  });
});

describe('reordering and removing tracks', () => {
  it('moves a track up and down', async () => {
    mount();
    act(() => {
      store.getState().createPlaylist('Mix', [song('a'), song('b'), song('c')]);
    });
    await openPlaylist('Mix');

    await user.click(screen.getByRole('button', { name: 'Move Title c earlier' }));
    expect(store.getState().playlists[0].songs.map((item) => item.id)).toEqual(['a', 'c', 'b']);

    await user.click(screen.getByRole('button', { name: 'Move Title a later' }));
    expect(store.getState().playlists[0].songs.map((item) => item.id)).toEqual(['c', 'a', 'b']);
  });

  it('disables the moves that would fall off either end', async () => {
    mount();
    act(() => {
      store.getState().createPlaylist('Mix', [song('a'), song('b')]);
    });
    await openPlaylist('Mix');

    expect(screen.getByRole('button', { name: 'Move Title a earlier' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Title b later' })).toBeDisabled();
  });

  it('removes a track without touching the others', async () => {
    mount();
    act(() => {
      store.getState().createPlaylist('Mix', [song('a'), song('b'), song('c')]);
    });
    await openPlaylist('Mix');

    await user.click(screen.getByRole('button', { name: 'Remove Title b from Mix' }));

    expect(store.getState().playlists[0].songs.map((item) => item.id)).toEqual(['a', 'c']);
  });
});

describe('playing', () => {
  it('queues the whole playlist in order', async () => {
    mount();
    act(() => {
      store.getState().createPlaylist('Mix', [song('a'), song('b')]);
    });
    await openPlaylist('Mix');

    await user.click(screen.getByRole('button', { name: 'Play' }));

    expect(store.getState().queue.map((item) => item.song.id)).toEqual(['a', 'b']);
    expect(store.getState().currentSong?.id).toBe('a');
  });

  it('offers nothing to play for an empty playlist', async () => {
    mount();
    act(() => {
      store.getState().createPlaylist('Empty');
    });
    await openPlaylist('Empty');

    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Shuffle' })).toBeDisabled();
  });
});

describe('the list itself', () => {
  it('shows each playlist with its track count', async () => {
    mount();
    act(() => {
      store.getState().createPlaylist('One', [song('a')]);
    });
    act(() => {
      store.getState().createPlaylist('Two', [song('a'), song('b')]);
    });

    const one = screen.getByRole('button', { name: 'Open playlist One' });
    const two = screen.getByRole('button', { name: 'Open playlist Two' });

    expect(within(one).getByText(/1 track$/)).toBeInTheDocument();
    expect(within(two).getByText(/2 tracks$/)).toBeInTheDocument();
  });

  it('points at somewhere to go when there are no playlists yet', () => {
    const onNavigate = vi.fn();
    render(
      <PlayerStoreProvider initialView="playlist" initialQuery="">
        <Probe />
        <PlaylistsView onNavigate={onNavigate} />
      </PlayerStoreProvider>,
    );

    expect(screen.getByRole('button', { name: /Browse trending/ })).toBeInTheDocument();
  });
});
