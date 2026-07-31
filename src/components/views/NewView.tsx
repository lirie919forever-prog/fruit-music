'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, type Variants } from 'motion/react';
import {
  HiArrowPath,
  HiChartBar,
  HiChevronRight,
  HiClock,
  HiGlobeAlt,
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
import { CinematicHero } from './CinematicHero';
import { CoverArt } from '@/components/ui/CoverArt';
import { TrackMenu } from '@/components/ui/TrackMenu';
import { StatusButton, StatusPanel } from '@/components/ui/StatusPanel';
import { api } from '@/lib/api';
import { catalogStaleTime, countListResults } from '@/lib/catalogFreshness';
import { buildNavigationUrl, type NavigationItem } from '@/lib/navigation';
import {
  buildListeningMixForAccess,
  filterSongsByAccess,
  playableSongs,
  selectSongsByAccess,
  uniqueSongs,
  type AudioAccessMode,
} from './newViewModel';
import { useNewViewData } from './useNewViewData';
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
}

const CHART_OPTIONS: ChartOption[] = [
  { key: 'billboard', label: 'United States', view: 'billboard' },
  { key: 'uk', label: 'United Kingdom', view: 'uk' },
  { key: 'jp', label: 'Japan', view: 'jp' },
];
const CHART_PREVIEW_LIMIT = 6;

// The page-load orchestration Anthropic's frontend-design skill asks for:
// each top-level shelf lifts in slightly out-of-phase with its neighbours so
// /new assembles top-to-bottom on first paint instead of materialising at once.
// Reduced-motion is honoured by the resolver automatically (motion skips the
// transform/opacity when the user has asked the OS for less motion).
const SHELF_VARIANTS: Variants = {
  hidden: { opacity: 0, y: 16 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
};
const STAGGER: Variants = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.07, delayChildren: 0.04 } },
};

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
    <motion.section variants={SHELF_VARIANTS} className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        {view ? (
          <button
            type="button"
            onClick={openSection}
            className="group -mx-1 flex min-w-0 items-center gap-0.5 rounded px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
          >
            <h2 className="min-w-0 truncate font-headline text-[17px] font-semibold tracking-[-0.01em] text-[var(--salt-white)]">
              {title}
            </h2>
            <HiChevronRight
              className="h-4 w-4 shrink-0 text-[var(--salt-mist)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--salt-primary)]"
              aria-hidden
            />
            <span className="sr-only">See all</span>
          </button>
        ) : (
          <h2 className="min-w-0 truncate font-headline text-[17px] font-semibold tracking-[-0.01em] text-[var(--salt-white)]">
            {title}
          </h2>
        )}
        {action}
      </div>
      {children}
    </motion.section>
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

const AUDIO_ACCESS_OPTIONS: Array<{ mode: AudioAccessMode; label: string }> = [
  { mode: 'full', label: 'Full tracks' },
  { mode: 'all', label: 'All audio' },
  { mode: 'preview', label: 'Previews' },
];

function AudioAccessControl({ mode, onChange }: { mode: AudioAccessMode; onChange: (mode: AudioAccessMode) => void }) {
  return (
    <div
      className="grid w-full grid-cols-3 gap-1 rounded-lg bg-[var(--salt-ghost)] p-1 sm:w-auto sm:min-w-[300px]"
      role="radiogroup"
      aria-label="Filter by playback access"
    >
      {AUDIO_ACCESS_OPTIONS.map((option) => {
        const selected = option.mode === mode;
        return (
          <button
            key={option.mode}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.mode)}
            className={`h-8 min-w-0 rounded-md px-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)] ${selected ? 'bg-white text-[var(--salt-white)] shadow-sm' : 'text-[var(--salt-mist)] hover:text-[var(--salt-white)]'}`}
          >
            <span className="block truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function DiscoveryMasthead({
  songs,
  mode,
  onModeChange,
}: {
  songs: Song[];
  mode: AudioAccessMode;
  onModeChange: (mode: AudioAccessMode) => void;
}) {
  const sourceCount = new Set(songs.map((song) => song.provider)).size;
  const summary =
    songs.length > 0
      ? `${songs.length} ${songs.length === 1 ? 'track' : 'tracks'} from ${sourceCount} ${sourceCount === 1 ? 'source' : 'sources'}`
      : 'Loading live catalog';

  return (
    <motion.section variants={SHELF_VARIANTS} className="border-b border-[var(--glass-border)] pb-5 sm:pb-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#bd3f4f]">Fresh picks</p>
          <h2 className="mt-1 font-headline text-[25px] font-semibold leading-[1.1] tracking-[-0.02em] text-[var(--salt-white)] sm:text-[32px]">
            New music
          </h2>
          <p className="mt-1 text-[13px] text-[var(--salt-mist)]">{summary}</p>
        </div>
        <PlayShelfButton songs={songs} label="Play fresh picks" />
      </div>
      <div className="mt-4">
        <AudioAccessControl mode={mode} onChange={onModeChange} />
      </div>
    </motion.section>
  );
}

function EmptyDiscovery({ onNavigate, onRetry }: { onNavigate: (view: ViewType) => void; onRetry?: () => void }) {
  return (
    <StatusPanel
      align="center"
      title="The live catalog is catching up"
      body="Your saved music is still ready, or search for a specific artist or track."
      actions={
        <>
          {onRetry && (
            <StatusButton onClick={onRetry}>
              <HiArrowPath className="h-4 w-4" aria-hidden />
              Try again
            </StatusButton>
          )}
          <StatusButton variant={onRetry ? 'secondary' : 'primary'} onClick={() => onNavigate('search')}>
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

function EmptyAccessMode({
  mode,
  onModeChange,
}: {
  mode: AudioAccessMode;
  onModeChange: (mode: AudioAccessMode) => void;
}) {
  const label = mode === 'full' ? 'full tracks' : 'previews';
  return (
    <StatusPanel
      align="center"
      title={`No ${label} are available in this selection`}
      body="Other audio is ready to browse."
      actions={
        <StatusButton onClick={() => onModeChange('all')}>
          <HiPlay className="h-4 w-4" aria-hidden />
          Show all audio
        </StatusButton>
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
  const visibleSongs = uniqueSongs(songs);
  const readySongs = playableSongs(visibleSongs);
  return (
    <div className="grid gap-x-8 md:grid-cols-2 xl:grid-cols-3">
      {visibleSongs.map((song) => (
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

function LiveStationGrid({
  songs,
  onNavigateWithItem,
}: {
  songs: Song[];
  onNavigateWithItem: (view: ViewType, item: NavigationItem | null) => void;
}) {
  const playAlbum = usePlayerStore((state) => state.playAlbum);
  const currentSong = usePlayerStore((state) => state.currentSong);
  const visibleSongs = uniqueSongs(songs);
  const readySongs = playableSongs(visibleSongs);

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {visibleSongs.slice(0, 6).map((song, index) => {
        const playableIndex = readySongs.findIndex((track) => track.id === song.id);
        const unavailable = playableIndex < 0;
        const active = currentSong?.id === song.id;
        const play = () => {
          if (!unavailable) playAlbum(readySongs, playableIndex);
        };

        return (
          <article
            key={song.id}
            className={`grid min-h-[104px] grid-cols-[80px_minmax(0,1fr)] gap-3 rounded-lg border border-[var(--glass-border)] bg-white p-2 transition-colors hover:border-[var(--glass-border-active)] ${index >= 4 ? 'hidden sm:grid' : ''} ${active ? 'bg-[color-mix(in_srgb,var(--salt-primary)_7%,white)]' : ''}`}
          >
            <button
              type="button"
              onClick={play}
              disabled={unavailable}
              aria-label={
                unavailable ? `${song.title} is unavailable for playback` : `Play ${song.title} by ${song.artist}`
              }
              className="group/live relative h-20 w-20 overflow-hidden rounded bg-[var(--salt-ghost)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)] disabled:cursor-not-allowed"
            >
              <CoverArt src={song.coverArt} alt="" loading="lazy" sizes="80px" className="h-full w-full object-cover" />
              <span className="absolute left-1.5 top-1.5 rounded bg-[#d84f5f] px-1.5 py-0.5 text-[9px] font-bold text-white">
                LIVE
              </span>
              <span
                aria-hidden
                className={`absolute inset-0 flex items-center justify-center bg-black/40 text-white transition-opacity ${unavailable ? 'opacity-0' : 'opacity-0 group-hover/live:opacity-100 group-focus-visible/live:opacity-100'}`}
              >
                <HiPlay className="h-5 w-5" />
              </span>
            </button>
            <div className="flex min-w-0 flex-col justify-between py-0.5">
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={play}
                  disabled={unavailable}
                  aria-label={
                    unavailable ? `${song.title} is unavailable for playback` : `Play ${song.title} by ${song.artist}`
                  }
                  className={`block max-w-full truncate text-left text-[13px] font-semibold leading-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)] disabled:cursor-not-allowed ${active ? 'text-[var(--salt-primary)]' : 'text-[var(--salt-white)]'}`}
                >
                  {song.title}
                </button>
                <p className="mt-1 truncate text-xs leading-tight text-[var(--salt-mist)]">
                  {song.album || song.genre}
                </p>
              </div>
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="truncate text-[11px] font-medium text-[var(--salt-primary)]">{song.provider}</span>
                <TrackMenu song={song} onNavigateWithItem={onNavigateWithItem} />
              </div>
            </div>
          </article>
        );
      })}
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
  onNavigateWithItem,
  discoveryReady,
  billboardSongs,
}: {
  onNavigateWithItem: (view: ViewType, item: NavigationItem | null) => void;
  discoveryReady: boolean;
  billboardSongs: Song[];
}) {
  const [activeKey, setActiveKey] = useState<ChartKey>(CHART_OPTIONS[0].key);
  const [isVisible, setIsVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = CHART_OPTIONS.find((option) => option.key === activeKey) ?? CHART_OPTIONS[0];
  const hasCompleteBillboardSeed = selected.key === 'billboard' && billboardSongs.length >= CHART_PREVIEW_LIMIT;

  useEffect(() => {
    if (!discoveryReady || isVisible) return;
    const container = containerRef.current;
    if (!container) return;
    let observer: IntersectionObserver | undefined;
    // Let the populated discovery shelves commit before measuring this
    // section. Observing against the compact loading placeholders made the
    // chart compete with the six initial catalog requests above it.
    const activation = setTimeout(() => {
      if (typeof IntersectionObserver === 'undefined') {
        setIsVisible(true);
        return;
      }
      observer = new IntersectionObserver(
        ([entry]) => {
          if (!entry?.isIntersecting) return;
          setIsVisible(true);
          observer?.disconnect();
        },
        { rootMargin: '320px 0px' },
      );
      observer.observe(container);
    }, 200);

    return () => {
      clearTimeout(activation);
      observer?.disconnect();
    };
  }, [discoveryReady, isVisible]);

  const {
    data: queriedSongs = [],
    isPending: queryPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['new', 'chart', selected.key],
    queryFn: ({ signal }) => api.getChartSongs(selected.key, signal),
    staleTime: catalogStaleTime(countListResults),
    retry: 1,
    enabled: discoveryReady && isVisible && !hasCompleteBillboardSeed,
  });
  const songs = hasCompleteBillboardSeed ? billboardSongs : queriedSongs;
  const isPending = !hasCompleteBillboardSeed && queryPending;

  return (
    <div ref={containerRef}>
      <Shelf
        title="Chart watch"
        view={selected.view}
        action={
          <div
            className="inline-flex max-w-full gap-1 overflow-x-auto rounded-full bg-[var(--salt-ghost)] p-0.5"
            role="tablist"
            aria-label="Choose chart"
          >
            {CHART_OPTIONS.map((option) => {
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
          {!isVisible || isPending ? (
            <SectionLoading rows={6} />
          ) : songs.length > 0 ? (
            <ChartRail
              songs={songs.slice(0, CHART_PREVIEW_LIMIT)}
              label={`${selected.label} chart`}
              onNavigateWithItem={onNavigateWithItem}
            />
          ) : (
            <div className="flex min-h-28 flex-col items-center justify-center gap-2.5 rounded-lg border border-[var(--glass-border)] bg-white text-center text-[13px] text-[var(--salt-mist)]">
              <p>
                {isError
                  ? `${selected.label} is temporarily unavailable.`
                  : `No ${selected.label} entries are available.`}
              </p>
              <button
                type="button"
                onClick={() => void refetch()}
                className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-[var(--salt-primary)] hover:bg-[var(--glass-bg-hover)]"
              >
                <HiArrowPath className="h-4 w-4" aria-hidden />
                Retry
              </button>
            </div>
          )}
        </div>
      </Shelf>
    </div>
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
    // The `jp` view renders Apple's Japan Top Songs chart — a real ranking as
    // 30-second previews. Audius/Jamendo carry no J-Pop, so the chart is the
    // J-Pop showcase rather than a federated full-track shelf.
    { view: 'jp', icon: <HiGlobeAlt />, label: 'J-Pop' },
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
  const favorites = usePlayerStore((state) => state.favorites);
  const addToQueue = usePlayerStore((state) => state.addToQueue);
  const setCurrentView = usePlayerStore((state) => state.setCurrentView);
  const [accessMode, setAccessMode] = useState<AudioAccessMode>('full');

  const {
    genres,
    spotlightSongs,
    bestNewSongs,
    liveStations,
    releaseSongs,
    billboardSongs,
    hasCatalogFailure,
    isLoading: discoveryLoading,
    retry: retrySources,
  } = useNewViewData();

  const filteredBestNewSongs = useMemo(
    () => uniqueSongs(selectSongsByAccess(bestNewSongs, accessMode, 12)),
    [accessMode, bestNewSongs],
  );
  const filteredSpotlightSongs = useMemo(() => {
    const directMatches = uniqueSongs(selectSongsByAccess(spotlightSongs, accessMode, 2));
    return directMatches.length > 0 ? directMatches : filteredBestNewSongs.slice(0, 2);
  }, [accessMode, filteredBestNewSongs, spotlightSongs]);
  const filteredReleaseSongs = useMemo(
    () => uniqueSongs(selectSongsByAccess(releaseSongs, accessMode, 10)),
    [accessMode, releaseSongs],
  );
  const filteredLiveStations = useMemo(
    () => uniqueSongs(selectSongsByAccess(liveStations, accessMode, 12)),
    [accessMode, liveStations],
  );
  const personalizedMix = useMemo(
    () =>
      buildListeningMixForAccess(
        history,
        favorites,
        [bestNewSongs, genres.pop, genres.jazz, genres.remix, genres.classical, liveStations].flat(),
        accessMode,
        12,
      ),
    [
      accessMode,
      bestNewSongs,
      favorites,
      genres.classical,
      genres.jazz,
      genres.pop,
      genres.remix,
      history,
      liveStations,
    ],
  );
  const spotlightOrder = filteredSpotlightSongs.map((song) => song.id).join('|');
  const spotlightRailRef = useRef<HTMLDivElement>(null);
  const mastheadSongs = filteredBestNewSongs.length > 0 ? filteredBestNewSongs : filteredSpotlightSongs;

  useEffect(() => {
    if (spotlightRailRef.current) spotlightRailRef.current.scrollLeft = 0;
  }, [spotlightOrder]);

  const navigate = (view: ViewType) => {
    navigateTo(view);
    setCurrentView(view);
  };

  const genrePanels = [
    { title: 'Pop', view: 'pop' as const, songs: uniqueSongs(filterSongsByAccess(genres.pop, accessMode)) },
    { title: 'Jazz', view: 'jazz' as const, songs: uniqueSongs(filterSongsByAccess(genres.jazz, accessMode)) },
    { title: 'Remixes', view: 'remixes' as const, songs: uniqueSongs(filterSongsByAccess(genres.remix, accessMode)) },
    { title: 'Classical', view: 'classical' as const, songs: uniqueSongs(filterSongsByAccess(genres.classical, accessMode)) },
  ].filter(({ songs }) => songs.length > 0);
  const hasFilteredDiscovery =
    filteredSpotlightSongs.length > 0 ||
    filteredBestNewSongs.length > 0 ||
    filteredLiveStations.length > 0 ||
    filteredReleaseSongs.length > 0 ||
    genrePanels.length > 0;
  const hasAnyDiscovery =
    spotlightSongs.length > 0 ||
    bestNewSongs.length > 0 ||
    liveStations.length > 0 ||
    releaseSongs.length > 0 ||
    Object.values(genres).some((songs) => songs.length > 0);

  return (
    <motion.div
      initial="hidden"
      animate="shown"
      variants={STAGGER}
      className="space-y-7 pb-8 sm:space-y-9"
    >
      <DiscoveryMasthead songs={mastheadSongs} mode={accessMode} onModeChange={setAccessMode} />

      {(history.length > 0 || favorites.length > 0) && personalizedMix.length > 0 && (
        <Shelf title="Your next mix" action={<PlayShelfButton songs={personalizedMix} label="Play your next mix" />}>
          <DiscoverySongGrid songs={personalizedMix} onNavigateWithItem={onNavigateWithItem} />
        </Shelf>
      )}

      {filteredLiveStations.length > 0 && (
        <Shelf title="Live right now" action={<PlayShelfButton songs={filteredLiveStations} label="Play live radio" />}>
          <LiveStationGrid songs={filteredLiveStations} onNavigateWithItem={onNavigateWithItem} />
        </Shelf>
      )}

      {filteredSpotlightSongs.length > 0 ? (
        <div ref={spotlightRailRef}>
          <CinematicHero
            song={filteredSpotlightSongs[0]}
            eyebrow={filteredSpotlightSongs[0].metadataVerified ? 'Marea pick' : 'Chart watch'}
            onQueue={
              filteredSpotlightSongs[0].playbackUnavailable
                ? undefined
                : () => addToQueue(filteredSpotlightSongs[0])
            }
            onNavigateWithItem={onNavigateWithItem}
          />
          {filteredSpotlightSongs.length > 1 && (
            <Shelf title="Also in the spotlight">
              <div className="rail-scroll flex snap-x snap-mandatory scroll-pl-0 gap-3 overflow-x-auto [overflow-anchor:none] lg:grid lg:grid-cols-2 lg:gap-4 lg:overflow-visible">
                {filteredSpotlightSongs.slice(1).map((song) => (
                  <div
                    key={song.id}
                    className="w-[88%] max-w-[480px] shrink-0 snap-start lg:w-auto lg:max-w-none"
                  >
                    <EditorialBanner
                      song={song}
                      eyebrow={song.metadataVerified ? 'New release' : 'Chart watch'}
                      onQueue={song.playbackUnavailable ? undefined : () => addToQueue(song)}
                      onNavigateWithItem={onNavigateWithItem}
                    />
                  </div>
                ))}
              </div>
            </Shelf>
          )}
        </div>
      ) : discoveryLoading ? (
        <Shelf title="In the spotlight">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="h-[184px] animate-pulse rounded-xl bg-[var(--salt-ghost)]" />
            <div className="h-[184px] animate-pulse rounded-xl bg-[var(--salt-ghost)]" />
          </div>
        </Shelf>
      ) : !hasFilteredDiscovery ? (
        hasAnyDiscovery ? (
          <EmptyAccessMode mode={accessMode} onModeChange={setAccessMode} />
        ) : (
          <EmptyDiscovery onNavigate={navigate} onRetry={hasCatalogFailure ? retrySources : undefined} />
        )
      ) : null}

      {filteredBestNewSongs.length > 0 && (
        <Shelf
          title="Songs making waves"
          view="trending"
          action={<PlayShelfButton songs={filteredBestNewSongs} label="Play the new music mix" />}
        >
          <DiscoverySongGrid songs={filteredBestNewSongs} onNavigateWithItem={onNavigateWithItem} />
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

      {filteredReleaseSongs.length > 0 && (
        <Shelf title="New records to explore" view="albums">
          <ReleaseRail songs={filteredReleaseSongs} onNavigateWithItem={onNavigateWithItem} />
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

      {accessMode !== 'full' && (
        <ChartPreview
          billboardSongs={billboardSongs}
          discoveryReady={!discoveryLoading}
          onNavigateWithItem={onNavigateWithItem}
        />
      )}

      <Shelf title="Explore Marea">
        <ExploreGrid />
      </Shelf>
    </motion.div>
  );
}
