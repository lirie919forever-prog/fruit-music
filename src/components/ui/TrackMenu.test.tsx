/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { PlayerStoreProvider, usePlayerStoreApi, type PlayerStore } from '@/store/playerStore';
import { resetBodyScrollLock } from '@/lib/scrollLock';
import { TrackMenu } from './TrackMenu';
import type { Song } from '@/types/music';
import { useEffect } from 'react';

function song(id: string, overrides: Partial<Song> = {}): Song {
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
    sourceUrl: 'https://example.com/track',
    creatorUrl: '',
    licenseName: 'CC BY',
    licenseUrl: '',
    attributionUrl: '',
    metadataVerified: true,
    ...overrides,
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

function mount(ui: ReactElement) {
  return render(
    <PlayerStoreProvider initialView="albums" initialQuery="">
      <Probe />
      {ui}
      <button type="button">outside</button>
    </PlayerStoreProvider>,
  );
}

let user: UserEvent;

beforeEach(() => {
  window.localStorage.clear();
  resetBodyScrollLock();
  user = userEvent.setup();
});

afterEach(() => {
  resetBodyScrollLock();
});

/**
 * Every item in DOM order, whatever its exact role. Testing Library's role
 * queries take one exact role, and this menu mixes menuitem with
 * menuitemcheckbox — asserting the roving tabindex needs all of them in the
 * order they are focused.
 */
function menuItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>('[role^="menuitem"]'));
}

async function openMenu(): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: /More options/ }));
  return screen.getByRole('menu');
}

describe('opening and dismissing', () => {
  it('exposes the trigger as a menu button and wires it to the panel', async () => {
    mount(<TrackMenu song={song('a')} />);
    const trigger = screen.getByRole('button', { name: 'More options for Title a' });

    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    const menu = await openMenu();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls', menu.id);
  });

  it('closes on Escape and hands focus back to the trigger', async () => {
    mount(<TrackMenu song={song('a')} />);
    const trigger = screen.getByRole('button', { name: /More options/ });
    await openMenu();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes when a click lands outside, without stealing focus back', async () => {
    mount(<TrackMenu song={song('a')} />);
    await openMenu();

    await user.click(screen.getByRole('button', { name: 'outside' }));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    // Focus belongs to whatever the user clicked, not to the menu they left.
    expect(screen.getByRole('button', { name: /More options/ })).not.toHaveFocus();
  });
});

describe('roving tabindex', () => {
  it('keeps exactly one item tabbable and moves it with the arrow keys', async () => {
    mount(<TrackMenu song={song('a')} />);
    const menu = await openMenu();
    const items = menuItems(menu);

    const tabbable = () => items.filter((item) => item.getAttribute('tabindex') === '0');
    expect(tabbable()).toHaveLength(1);
    expect(items[0]).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(tabbable()).toHaveLength(1);
    expect(items[1]).toHaveFocus();

    await user.keyboard('{ArrowUp}{ArrowUp}');
    // Wraps to the end rather than stopping at the first item.
    expect(items[items.length - 1]).toHaveFocus();

    await user.keyboard('{Home}');
    expect(items[0]).toHaveFocus();
    await user.keyboard('{End}');
    expect(items[items.length - 1]).toHaveFocus();
  });

  it('opens onto the last item when arrowing up from the trigger', async () => {
    mount(<TrackMenu song={song('a')} />);
    const trigger = screen.getByRole('button', { name: /More options/ });
    trigger.focus();

    await user.keyboard('{ArrowUp}');

    const items = menuItems(screen.getByRole('menu'));
    expect(items[items.length - 1]).toHaveFocus();
  });
});

describe('favorite toggle', () => {
  it('announces its state as a checkbox, which role=menuitem cannot do', async () => {
    mount(<TrackMenu song={song('a')} />);
    await openMenu();

    const favorite = screen.getByRole('menuitemcheckbox', { name: 'Add to Favorites' });
    // `aria-pressed` on a menuitem is an invalid combination and is dropped, so
    // the state has to travel on aria-checked instead.
    expect(favorite).toHaveAttribute('aria-checked', 'false');
    expect(favorite).not.toHaveAttribute('aria-pressed');
  });

  it('adds the track to favorites and reflects it on reopen', async () => {
    mount(<TrackMenu song={song('a')} />);
    await openMenu();

    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Add to Favorites' }));

    expect(store.getState().favorites.map((item) => item.id)).toEqual(['a']);
    await openMenu();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Remove from Favorites' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('removes it again on a second toggle', async () => {
    mount(<TrackMenu song={song('a')} />);
    await openMenu();
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Add to Favorites' }));
    await openMenu();
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Remove from Favorites' }));

    expect(store.getState().favorites).toEqual([]);
  });
});

describe('queue actions', () => {
  it('offers no playback actions for a track the provider cannot stream', async () => {
    mount(<TrackMenu song={song('a', { playbackUnavailable: true })} />);
    await openMenu();

    expect(screen.queryByRole('menuitem', { name: 'Play next' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Add to queue' })).not.toBeInTheDocument();
    // Favouriting an unplayable track is still meaningful.
    expect(screen.getByRole('menuitemcheckbox', { name: 'Add to Favorites' })).toBeInTheDocument();
  });

  it('inserts after the current track for Play next, and appends for Add to queue', async () => {
    mount(<TrackMenu song={song('c')} />);
    store.getState().setQueue([song('a'), song('b')], 0);

    await openMenu();
    await user.click(screen.getByRole('menuitem', { name: 'Play next' }));
    expect(store.getState().queue.map((item) => item.song.id)).toEqual(['a', 'c', 'b']);

    await openMenu();
    await user.click(screen.getByRole('menuitem', { name: 'Add to queue' }));
    expect(store.getState().queue.map((item) => item.song.id)).toEqual(['a', 'c', 'b', 'c']);
  });

  it('names the licence on the provenance link rather than hiding it', async () => {
    mount(<TrackMenu song={song('a')} />);
    await openMenu();

    const link = screen.getByRole('menuitem', { name: 'Jamendo · CC BY' });
    expect(link).toHaveAttribute('href', 'https://example.com/track');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });
});
