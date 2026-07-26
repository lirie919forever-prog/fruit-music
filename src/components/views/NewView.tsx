'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  HiArrowPath,
  HiChartBar,
  HiChevronRight,
  HiClock,
  HiExclamationTriangle,
  HiHeart,
  HiLockClosed,
  HiMagnifyingGlass,
  HiPlay,
  HiSquares2X2,
  HiUserGroup,
} from 'react-icons/hi2';
import { usePlayerStore } from '@/store/playerStore';
import { ArtistLink, ChartRail, SongRail } from './SongCard';
import { EditorialBanner } from './EditorialBanner';
import { CoverArt } from '@/components/ui/CoverArt';
import { TrackMenu } from '@/components/ui/TrackMenu';
import { StatusButton, StatusPanel } from '@/components/ui/StatusPanel';
import { buildNavigationUrl, type NavigationItem } from '@/lib/navigation';
import { catalogStaleTime, countListResults } from '@/lib/catalogFreshness';
import { playableSongs } from './newViewModel';
import { useNewViewData } from './useNewViewData';
import type { FederatedResult } from '@/lib/api';
import type { Song, ViewType } from '@/types/music';

interface ShelfProps {
  title: string;
  view?: ViewType;
  action?: ReactNode;
  children: ReactNode;
}

type ChartKey = 'billboard' | 'uk' | 'jp';

interface ChartOption {
  key: ChartKey;
  label: string;
  view: ViewType;
  songs: Song[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

function navigateTo(view: ViewType): void {
  window.history.pushState(null, '', buildNavigationUrl(window.location, view));
}

/**
 * A browse shelf: a 17px title that is itself the link into the full view, and
 * nothing else. Explanatory subtitles under every heading were costing a line of
 * vertical space per section for text nobody needs twice — a shelf called "Jazz"
 * does not need to say it contains jazz.
 */
function Shelf({ title, view, action, children }: ShelfProps) {
  const setCurrentView = usePlayerStore((state) => state.setCurrentView);
  const openSection = () => {
    if (!view) return;
    navigateTo(view);
    setCurrentView(view);
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        {view ? (
          <button
            type="button"
            onClick={openSection}
            className="group -mx-1 flex min-w-0 items-center gap-0.5 rounded px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
          >
            <h2 className="min-w-0 truncate text-[17px] font-bold tracking-[-0.01em] text-[var(--salt-white)]">
              {title}
            </h2>
            <HiChevronRight
              className="h-4 w-4 shrink-0 text-[var(--salt-mist)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--salt-primary)]"
              aria-hidden
            />
            <span className="sr-only">See all</span>
          </button>
        ) : (
          <h2 className="min-w-0 truncate text-[17px] font-bold tracking-[-0.01em] text-[var(--salt-white)]">
            {title}
          </h2>
        )}
        {action}
      </div>
      {children}
    </section>
  );
}

function SectionLoading({ rows = 6 }: { rows?: number }) {
  return (
    <div className="grid gap-x-6 md:grid-cols-2 xl:grid-cols-3" aria-label="Loading music">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex h-14 items-center gap-3 border-b border-[var(--glass-border)] px-1">
          <div className="h-10 w-10 shrink-0 animate-pulse rounded bg-[var(--salt-ghost)]" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 w-3/4 animate-pulse rounded bg-[var(--salt-ghost)]" />
            <div className="h-2.5 w-1/2 animate-pulse rounded bg-[var(--salt-ghost)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Plays a whole shelf, mirroring the play button Apple reveals on shelf titles. */
function PlayShelfButton({ songs, label }: { songs: Song[]; label: string }) {
  const playAlbum = usePlayerStore((state) => state.playAlbum);
  const readySongs = playableSongs(songs);
  if (readySongs.length === 0) return null;

  return (
    <button
      type="button"
      onClick={() => playAlbum(readySongs, 0)}
      aria-label={label}
      title={label}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-[#d84f5f] px-3 text-[13px] font-semibold text-white transition-colors hover:bg-[#bd3f4f]"
    >
      <HiPlay className="h-3.5 w-3.5" aria-hidden />
      Play
    </button>
  );
}

function CatalogNotice({ issues, onRetry }: { issues: string[]; onRetry: () => void }) {
  if (!issues.length) return null;
  const mobileSummary =
    issues.length === 1
      ? '1 catalog feed affected. Showing available music.'
      : `${issues.length} catalog feeds affected. Showing available music.`;

  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-lg border border-[#e6c3c6] bg-[#fdf5f5] px-3 py-2 text-[13px] text-[#77343d] sm:gap-3"
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <HiExclamationTriangle className="h-4 w-4 shrink-0" aria-hidden />
        <span className="min-w-0 sm:hidden">{mobileSummary}</span>
        <span className="hidden min-w-0 sm:inline">
          Affected feeds: {issues.join(', ')}. Available music remains in place.
        </span>
      </span>
      <button
        type="button"
        onClick={onRetry}
        aria-label="Retry unavailable sources"
        title="Retry unavailable sources"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold hover:bg-[#f6e3e4] sm:w-auto sm:gap-1.5 sm:px-3"
      >
        <HiArrowPath className="h-4 w-4" aria-hidden />
        <span className="hidden sm:inline">Retry</span>
      </button>
    </div>
  );
}

function EmptyDiscovery({ onNavigate }: { onNavigate: (view: ViewType) => void }) {
  return (
    <StatusPanel
      align="center"
      title="The live catalog is catching up"
      body="Your saved music is still ready, or search for a specific artist or track."
      actions={
        <>
          <StatusButton onClick={() => onNavigate('search')}>
            <HiMagnifyingGlass className="h-4 w-4" aria-hidden />
            Search
          </StatusButton>
          <StatusButton variant="secondary" onClick={() => onNavigate('favorites')}>
            <HiHeart className="h-4 w-4" aria-hidden />
            Favorites
          </StatusButton>
        </>
      }
    />
  );
}

function DiscoverySongRow({
  song,
  playableTracks,
  onNavigateWithItem,
}: {
  song: Song;
  playableTracks: Song[];
  onNavigateWithItem: (view: ViewType, item: NavigationItem | null) => void;
}) {
  const playAlbum = usePlayerStore((state) => state.playAlbum);
  const currentSong = usePlayerStore((state) => state.currentSong);
  const playableIndex = playableTracks.findIndex((track) => track.id === song.id);
  const unavailable = playableIndex < 0;
  const active = currentSong?.id === song.id;
  const play = () => {
    if (!unavailable) playAlbum(playableTracks, playableIndex);
  };

  return (
    <article
      className={`flex h-14 items-center gap-3 border-b border-[var(--glass-border)] px-1 transition-colors ${active ? 'bg-[color-mix(in_srgb,var(--salt-primary)_7%,white)]' : 'hover:bg-[var(--glass-bg-hover)]'}`}
    >
      <button
        type="button"
        onClick={play}
        disabled={unavailable}
        aria-label={unavailable ? `${song.title} is unavailable for playback` : `Play ${song.title} by ${song.artist}`}
        className="group/art relative shrink-0 overflow-hidden rounded bg-[var(--salt-ghost)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)] disabled:cursor-not-allowed"
      >
        <CoverArt src={song.coverArt} alt="" loading="lazy" sizes="40px" className="h-10 w-10 object-cover" />
        <span
          aria-hidden
          className={`absolute inset-0 flex items-center justify-center bg-black/45 text-white transition-opacity ${unavailable ? 'opacity-0' : 'opacity-0 group-hover/art:opacity-100 group-focus-visible/art:opacity-100'}`}
        >
          <HiPlay className="h-4 w-4" />
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={play}
          disabled={unavailable}
          aria-label={
            unavailable ? `${song.title} is unavailable for playback` : `Play ${song.title} by ${song.artist}`
          }
          className={`block max-w-full truncate text-left text-[13px] font-medium leading-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)] disabled:cursor-not-allowed ${active ? 'text-[var(--salt-primary)]' : 'text-[var(--salt-white)]'}`}
        >
          {song.title}
        </button>
        <span className="mt-0.5 flex min-w-0 items-center gap-1 text-xs leading-tight text-[var(--salt-mist)]">
          <ArtistLink song={song} onNavigateWithItem={onNavigateWithItem} className="text-xs" />
          <span aria-hidden className="shrink-0">
            ·
          </span>
          <span className="shrink-0 truncate">{song.provider}</span>
        </span>
      </div>
      {unavailable && (
        <span
          title="Playback unavailable"
          aria-label="Playback unavailable"
          className="shrink-0 text-[var(--salt-mist)]"
        >
          <HiLockClosed className="h-3.5 w-3.5" aria-hidden />
        </span>
      )}
      <TrackMenu song={song} onNavigateWithItem={onNavigateWithItem} />
    </article>
  );
}

function DiscoverySongGrid({
  songs,
  onNavigateWithItem,
}: {
  songs: Song[];
  onNavigateWithItem: (view: ViewType, item: NavigationItem | null) => void;
}) {
  const readySongs = playableSongs(songs);
  return (
    <div className="grid gap-x-8 md:grid-cols-2 xl:grid-cols-3">
      {songs.map((song) => (
        <DiscoverySongRow
          key={song.id}
          song={song}
          playableTracks={readySongs}
          onNavigateWithItem={onNavigateWithItem}
        />
      ))}
    </div>
  );
}

function ReleaseRail({
  songs,
  onNavigateWithItem,
}: {
  songs: Song[];
  onNavigateWithItem: (view: ViewType, item: NavigationItem | null) => void;
}) {
  return (
    <div
      className="rail-scroll -mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 pb-1"
      aria-label="New releases"
    >
      {songs.map((song, index) => (
        <article key={song.albumId} className="w-[144px] shrink-0 snap-start sm:w-[168px]">
          <button
            type="button"
            onClick={() => onNavigateWithItem('albums', { kind: 'album', id: song.albumId })}
            className="group block w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
            aria-label={`Open ${song.album || song.title} by ${song.artist}`}
          >
            <span className="relative block aspect-square overflow-hidden rounded-lg bg-[var(--salt-ghost)]">
              <CoverArt
                src={song.coverArt}
                alt=""
                loading={index === 0 ? 'eager' : 'lazy'}
                sizes="(max-width: 640px) 144px, 168px"
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
              />
              <span
                aria-hidden
                className="absolute inset-0 flex items-center justify-center bg-black/35 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              >
                <HiPlay className="h-6 w-6" />
              </span>
            </span>
            <span className="mt-2 block truncate text-[13px] font-medium text-[var(--salt-white)]">
              {song.album || song.title}
            </span>
            <span className="mt-0.5 block truncate text-xs text-[var(--salt-mist)]">{song.artist}</span>
          </button>
        </article>
      ))}
    </div>
  );
}

function MiniSongList({
  songs,
  onNavigateWithItem,
}: {
  songs: Song[];
  onNavigateWithItem: (view: ViewType, item: NavigationItem | null) => void;
}) {
  const playAlbum = usePlayerStore((state) => state.playAlbum);
  const readySongs = playableSongs(songs);

  return (
    <div>
      {songs.slice(0, 4).map((song) => {
        const index = readySongs.findIndex((track) => track.id === song.id);
        const unavailable = index < 0;
        return (
          <div
            key={song.id}
            className="flex h-12 w-full min-w-0 items-center gap-2.5 border-b border-[var(--glass-border)] transition-colors last:border-b-0 hover:bg-[var(--glass-bg-hover)]"
          >
            <button
              type="button"
              disabled={unavailable}
              onClick={() => {
                if (!unavailable) playAlbum(readySongs, index);
              }}
              aria-label={unavailable ? `${song.title} is unavailable for playback` : `Play ${song.title}`}
              className="group/art relative shrink-0 overflow-hidden rounded bg-[var(--salt-ghost)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)] disabled:cursor-not-allowed"
            >
              <CoverArt src={song.coverArt} alt="" loading="lazy" sizes="36px" className="h-9 w-9 object-cover" />
              <span
                aria-hidden
                className={`absolute inset-0 flex items-center justify-center bg-black/45 text-white transition-opacity ${unavailable ? 'opacity-0' : 'opacity-0 group-hover/art:opacity-100 group-focus-visible/art:opacity-100'}`}
              >
                <HiPlay className="h-3.5 w-3.5" />
              </span>
            </button>
            <div className="min-w-0 flex-1">
              <button
                type="button"
                disabled={unavailable}
                onClick={() => {
                  if (!unavailable) playAlbum(readySongs, index);
                }}
                aria-label={unavailable ? `${song.title} is unavailable for playback` : `Play ${song.title}`}
                className="block w-full truncate text-left text-[13px] font-medium leading-tight text-[var(--salt-white)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)] disabled:cursor-not-allowed"
              >
                {song.title}
              </button>
              <ArtistLink
                song={song}
                onNavigateWithItem={onNavigateWithItem}
                className="mt-0.5 block text-xs leading-tight text-[var(--salt-mist)]"
              />
            </div>
            {unavailable && <HiLockClosed className="h-3.5 w-3.5 shrink-0 text-[var(--salt-mist)]" aria-hidden />}
            <TrackMenu song={song} onNavigateWithItem={onNavigateWithItem} />
          </div>
        );
      })}
    </div>
  );
}

function GenrePanel({
  title,
  view,
  songs,
  onNavigateWithItem,
}: {
  title: string;
  view: ViewType;
  songs: Song[];
  onNavigateWithItem: (view: ViewType, item: NavigationItem | null) => void;
}) {
  const setCurrentView = usePlayerStore((state) => state.setCurrentView);
  return (
    <section className="min-w-0">
      <button
        type="button"
        onClick={() => {
          navigateTo(view);
          setCurrentView(view);
        }}
        className="group -mx-1 mb-1 flex w-full min-w-0 items-center gap-0.5 rounded px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
      >
        <h3 className="min-w-0 truncate text-[15px] font-bold text-[var(--salt-white)]">{title}</h3>
        <HiChevronRight
          className="h-4 w-4 shrink-0 text-[var(--salt-mist)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--salt-primary)]"
          aria-hidden
        />
        <span className="sr-only">See all</span>
      </button>
      <MiniSongList songs={songs} onNavigateWithItem={onNavigateWithItem} />
    </section>
  );
}

function ChartPreview({
  options,
  onNavigateWithItem,
}: {
  options: ChartOption[];
  onNavigateWithItem: (view: ViewType, item: NavigationItem | null) => void;
}) {
  const [activeKey, setActiveKey] = useState<ChartKey>(options[0].key);
  const selected = options.find((option) => option.key === activeKey) ?? options[0];

  return (
    <Shelf
      title="Chart watch"
      view={selected.view}
      action={
        <div
          className="inline-flex max-w-full gap-1 overflow-x-auto rounded-full bg-[var(--salt-ghost)] p-0.5"
          role="tablist"
          aria-label="Choose chart"
        >
          {options.map((option) => {
            const active = option.key === selected.key;
            return (
              <button
                key={option.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveKey(option.key)}
                className={`h-7 shrink-0 rounded-full px-3 text-xs font-semibold transition-colors ${active ? 'bg-white text-[var(--salt-white)] shadow-sm' : 'text-[var(--salt-mist)] hover:text-[var(--salt-white)]'}`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      }
    >
      <div role="tabpanel" aria-label={`${selected.label} preview`}>
        {selected.isLoading ? (
          <SectionLoading rows={6} />
        ) : selected.songs.length > 0 ? (
          <ChartRail
            songs={selected.songs.slice(0, 6)}
            label={`${selected.label} chart`}
            onNavigateWithItem={onNavigateWithItem}
          />
        ) : (
          <div className="flex min-h-28 flex-col items-center justify-center gap-2.5 rounded-lg border border-[var(--glass-border)] bg-white text-center text-[13px] text-[var(--salt-mist)]">
            <p>
              {selected.isError
                ? `${selected.label} is temporarily unavailable.`
                : `No ${selected.label} entries are available.`}
            </p>
            <button
              type="button"
              onClick={selected.refetch}
              className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-[var(--salt-primary)] hover:bg-[var(--glass-bg-hover)]"
            >
              <HiArrowPath className="h-4 w-4" aria-hidden />
              Retry
            </button>
          </div>
        )}
      </div>
    </Shelf>
  );
}

function ExploreGrid() {
  const setCurrentView = usePlayerStore((state) => state.setCurrentView);
  const navigate = (view: ViewType) => {
    navigateTo(view);
    setCurrentView(view);
  };
  const items: Array<{ view: ViewType; icon: ReactNode; label: string }> = [
    { view: 'albums', icon: <HiSquares2X2 />, label: 'Albums' },
    { view: 'artists', icon: <HiUserGroup />, label: 'Artists' },
    { view: 'search', icon: <HiMagnifyingGlass />, label: 'Search' },
    { view: 'favorites', icon: <HiHeart />, label: 'Favorites' },
    { view: 'history', icon: <HiClock />, label: 'History' },
    { view: 'billboard', icon: <HiChartBar />, label: 'Charts' },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {items.map(({ view, icon, label }) => (
        <button
          key={view}
          type="button"
          onClick={() => navigate(view)}
          className="flex h-12 items-center gap-2.5 rounded-lg border border-[var(--glass-border)] bg-white px-3 text-left text-[13px] font-semibold text-[var(--salt-white)] transition-colors hover:border-[var(--glass-border-active)] hover:bg-[var(--glass-bg-hover)]"
        >
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#eaf4f7] text-[var(--salt-primary)]"
            aria-hidden
          >
            {icon}
          </span>
          <span className="truncate">{label}</span>
        </button>
      ))}
    </div>
  );
}

export function NewView({
  onNavigateWithItem,
}: {
  onNavigateWithItem: (view: ViewType, item: NavigationItem | null) => void;
}) {
  const history = usePlayerStore((state) => state.history);
  const addToQueue = usePlayerStore((state) => state.addToQueue);
  const setCurrentView = usePlayerStore((state) => state.setCurrentView);

  const {
    charts: { billboard, uk, jp },
    genres,
    verifiedMix,
    spotlightSongs,
    bestNewSongs,
    releaseSongs,
    unavailableSources,
    isLoading: discoveryLoading,
    retry: retrySources,
  } = useNewViewData();

  const spotlightOrder = spotlightSongs.map((song) => song.id).join('|');
  const spotlightRailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (spotlightRailRef.current) spotlightRailRef.current.scrollLeft = 0;
  }, [spotlightOrder]);

  const navigate = (view: ViewType) => {
    navigateTo(view);
    setCurrentView(view);
  };

  const genrePanels = [
    { title: 'Pop', view: 'pop' as const, songs: genres.pop },
    { title: 'Jazz', view: 'jazz' as const, songs: genres.jazz },
    { title: 'Remixes', view: 'remixes' as const, songs: genres.remix },
    { title: 'Classical', view: 'classical' as const, songs: genres.classical },
  ].filter(({ songs }) => songs.length > 0);

  const chartOptions: ChartOption[] = [
    {
      key: 'billboard',
      label: 'United States',
      view: 'billboard',
      songs: billboard.data ?? [],
      isLoading: billboard.isPending,
      isError: billboard.isError,
      refetch: () => void billboard.refetch(),
    },
    {
      key: 'uk',
      label: 'United Kingdom',
      view: 'uk',
      songs: uk.data ?? [],
      isLoading: uk.isPending,
      isError: uk.isError,
      refetch: () => void uk.refetch(),
    },
    {
      key: 'jp',
      label: 'Japan',
      view: 'jp',
      songs: jp.data ?? [],
      isLoading: jp.isPending,
      isError: jp.isError,
      refetch: () => void jp.refetch(),
    },
  ];

  return (
    <div className="space-y-7 pb-8 sm:space-y-9">
      <CatalogNotice issues={unavailableSources} onRetry={retrySources} />

      {spotlightSongs.length > 0 ? (
        <Shelf title="In the spotlight">
          <div
            ref={spotlightRailRef}
            className={
              spotlightSongs.length > 1
                ? 'rail-scroll flex snap-x snap-mandatory scroll-pl-0 gap-3 overflow-x-auto [overflow-anchor:none] lg:grid lg:grid-cols-2 lg:gap-4 lg:overflow-visible'
                : 'grid'
            }
          >
            {spotlightSongs.map((song, index) => (
              <div
                key={song.id}
                className={
                  spotlightSongs.length > 1 ? 'w-[88%] max-w-[480px] shrink-0 snap-start lg:w-auto lg:max-w-none' : ''
                }
              >
                <EditorialBanner
                  song={song}
                  eyebrow={song.metadataVerified ? (index === 0 ? 'Marea pick' : 'New release') : 'Chart watch'}
                  // Both spotlight cards share the fold on wide viewports, so
                  // either can become the LCP element.
                  eager
                  onQueue={song.playbackUnavailable ? undefined : () => addToQueue(song)}
                  onNavigateWithItem={onNavigateWithItem}
                />
              </div>
            ))}
          </div>
        </Shelf>
      ) : discoveryLoading ? (
        <Shelf title="In the spotlight">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="h-[184px] animate-pulse rounded-xl bg-[var(--salt-ghost)]" />
            <div className="h-[184px] animate-pulse rounded-xl bg-[var(--salt-ghost)]" />
          </div>
        </Shelf>
      ) : (
        <EmptyDiscovery onNavigate={navigate} />
      )}

      {bestNewSongs.length > 0 && (
        <Shelf
          title="Songs making waves"
          view="trending"
          action={<PlayShelfButton songs={bestNewSongs} label="Play the new music mix" />}
        >
          <DiscoverySongGrid songs={bestNewSongs} onNavigateWithItem={onNavigateWithItem} />
        </Shelf>
      )}

      {history.length > 0 && (
        <Shelf title="Continue listening" view="history">
          <SongRail
            songs={history.slice(0, 8)}
            label="Recently played"
            showIndex={false}
            onNavigateWithItem={onNavigateWithItem}
          />
        </Shelf>
      )}

      {releaseSongs.length > 0 && (
        <Shelf title="New records to explore" view="albums">
          <ReleaseRail songs={releaseSongs} onNavigateWithItem={onNavigateWithItem} />
        </Shelf>
      )}

      {genrePanels.length > 0 && (
        <Shelf title="Fresh by genre">
          {/* Four columns at the widest size because there are four genres: at
              three, Classical drops onto a row of its own beside two empty
              thirds. */}
          <div className="grid gap-x-8 gap-y-6 md:grid-cols-2 xl:grid-cols-4">
            {genrePanels.map((panel) => (
              <GenrePanel key={panel.view} {...panel} onNavigateWithItem={onNavigateWithItem} />
            ))}
          </div>
        </Shelf>
      )}

      <ChartPreview options={chartOptions} onNavigateWithItem={onNavigateWithItem} />

      <Shelf title="Explore Marea">
        <ExploreGrid />
      </Shelf>
    </div>
  );
}
