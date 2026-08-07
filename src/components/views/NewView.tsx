'use client';

import {
  ChevronRight,
  Heart,
  Lightbulb,
  Lock,
  Moon,
  Play,
  RotateCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, type Variants } from 'motion/react';
import { usePlayerStore } from '@/store/playerStore';
import { ArtistLink, AudioAccessBadge, ChartRail, SongRail } from './SongCard';
import { ExploreGrid, navigateTo } from './discoveryShelves';
import { AudioAccessControl } from './AudioAccessControl';
import { EditorialBanner } from './EditorialBanner';
import { CinematicHero } from './CinematicHero';
import { CoverArt } from '@/components/ui/CoverArt';
import { TrackMenu } from '@/components/ui/TrackMenu';
import { StatusButton, StatusPanel } from '@/components/ui/StatusPanel';
import { VirtualGrid } from '@/components/ui/VirtualGrid';
import { catalogStaleTime, countListResults } from '@/lib/catalogFreshness';
import { type NavigationItem } from '@/lib/navigation';
import {
  buildDiscoveryMixForAccess,
  isDirectFullTrack,
  isCuratableTitle,
  playableSongs,
  selectSongsByAccess,
  uniqueSongs,
  type AudioAccessMode,
} from './newViewModel';
import { useNewViewData } from './useNewViewData';
import type { MusicProviderName, Song, ViewType } from '@/types/music';
import { isPreviewSource } from '@/lib/sourceRegistry';
import { useMusicCatalog } from '@/lib/musicCatalog';

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
            <ChevronRight
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

/** Horizontal skeleton for a shelf that renders row cards in a scrolling rail. */
function RailSkeleton({ cells = 4 }: { cells?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Loading music">
      {Array.from({ length: cells }, (_, index) => (
        <div
          key={index}
          className="flex items-center gap-3 rounded-lg border border-[var(--glass-border)] bg-white px-3 py-2"
        >
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
      className="marea-primary-action inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-white"
    >
      <Play className="h-3.5 w-3.5" aria-hidden />
      Play
    </button>
  );
}

interface SmartMix {
  key: string;
  label: string;
  detail: string;
  songs: Song[];
  icon: ReactNode;
  iconClassName: string;
}

function SmartMixShelf({ mixes, hasTaste }: { mixes: SmartMix[]; hasTaste: boolean }) {
  const playAlbum = usePlayerStore((state) => state.playAlbum);
  if (mixes.length === 0) return null;

  return (
    <Shelf title={hasTaste ? 'Your mixes' : 'Made for right now'}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {mixes.map((mix) => {
          const disabled = mix.songs.length === 0;
          return (
            <button
              key={mix.key}
              type="button"
              disabled={disabled}
              onClick={() => playAlbum(mix.songs, 0)}
              aria-label={`Play ${mix.label}`}
              className="marea-glass-card group flex min-h-[104px] min-w-0 items-center gap-3 rounded-lg border px-3.5 py-3 text-left transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
            >
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${mix.iconClassName}`}>
                {mix.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold text-[var(--salt-white)]">{mix.label}</span>
                <span className="mt-0.5 block truncate text-xs text-[var(--salt-mist)]">{mix.detail}</span>
                <span className="mt-1 block text-[11px] font-semibold text-[var(--salt-primary)]">
                  {disabled ? 'No tracks available' : `${mix.songs.length} tracks`}
                </span>
              </span>
              <Play
                className="h-4 w-4 shrink-0 text-[var(--salt-primary)] transition-transform group-hover:scale-110"
                aria-hidden
              />
            </button>
          );
        })}
      </div>
    </Shelf>
  );
}

type DiscoveryVibe = 'all' | 'focus' | 'energy' | 'after-dark';
type DiscoverySource = 'all' | MusicProviderName;

const VIBE_OPTIONS: Array<{ value: DiscoveryVibe; label: string }> = [
  { value: 'all', label: 'Everything' },
  { value: 'focus', label: 'Focus' },
  { value: 'energy', label: 'Energy' },
  { value: 'after-dark', label: 'After dark' },
];

const VIBE_TERMS: Record<Exclude<DiscoveryVibe, 'all'>, string[]> = {
  focus: ['focus', 'study', 'classical', 'piano', 'acoustic', 'ambient', 'instrumental', 'concentration'],
  energy: ['energy', 'dance', 'electronic', 'pop', 'rock', 'house', 'workout', 'remix', 'party'],
  'after-dark': ['night', 'noir', 'jazz', 'chill', 'lounge', 'downtempo', 'late', 'soul'],
};

function matchesDiscoveryLens(song: Song, source: DiscoverySource, vibe: DiscoveryVibe): boolean {
  if (source !== 'all' && song.provider !== source) return false;
  if (vibe === 'all') return true;
  const text = `${song.title} ${song.artist} ${song.album} ${song.genre}`.toLocaleLowerCase();
  return VIBE_TERMS[vibe].some((term) => text.includes(term));
}

function filterDiscoverySongs(
  songs: Song[],
  accessMode: AudioAccessMode,
  source: DiscoverySource,
  vibe: DiscoveryVibe,
): Song[] {
  return uniqueSongs(
    selectSongsByAccess(
      songs.filter((song) => matchesDiscoveryLens(song, source, vibe)),
      accessMode,
    ),
  );
}

function DiscoveryMasthead({
  songs,
  mode,
  onModeChange,
  sourceOptions,
  source,
  onSourceChange,
  vibe,
  onVibeChange,
  onSearch,
  onRetry,
}: {
  songs: Song[];
  mode: AudioAccessMode;
  onModeChange: (mode: AudioAccessMode) => void;
  sourceOptions: MusicProviderName[];
  source: DiscoverySource;
  onSourceChange: (source: DiscoverySource) => void;
  vibe: DiscoveryVibe;
  onVibeChange: (vibe: DiscoveryVibe) => void;
  onSearch: () => void;
  onRetry?: () => void;
}) {
  const sourceCount = new Set(songs.map((song) => song.provider)).size;
  const fullTrackSourceCount = new Set(
    songs.filter((song) => song.isLive !== true && isDirectFullTrack(song)).map((song) => song.provider),
  ).size;
  const summary =
    songs.length > 0
      ? `${songs.length} ${songs.length === 1 ? 'track' : 'tracks'} from ${sourceCount} ${sourceCount === 1 ? 'source' : 'sources'} · ${fullTrackSourceCount} full-track ${fullTrackSourceCount === 1 ? 'source' : 'sources'}`
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
      <div className="mt-4 flex flex-col gap-3 border-t border-[var(--glass-border)] pt-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className="inline-flex h-8 items-center gap-1.5 text-xs font-semibold text-[var(--salt-mist)]">
            <SlidersHorizontal className="h-4 w-4" aria-hidden />
            Refine
          </span>
          <label className="sr-only" htmlFor="discovery-source">
            Filter by source
          </label>
          <select
            id="discovery-source"
            value={source}
            onChange={(event) => onSourceChange(event.target.value as DiscoverySource)}
            className="h-8 max-w-full rounded-lg border border-[var(--glass-border)] bg-white px-2.5 text-xs font-semibold text-[var(--salt-white)] outline-none transition-colors hover:border-[var(--glass-border-active)] focus:border-[var(--salt-primary)] focus:ring-2 focus:ring-[var(--salt-primary)]/20"
          >
            <option value="all">All sources</option>
            {sourceOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <div
            className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-[var(--salt-ghost)] p-1"
            role="tablist"
            aria-label="Filter by vibe"
          >
            {VIBE_OPTIONS.map((option) => {
              const selected = option.value === vibe;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => onVibeChange(option.value)}
                  className={`h-6 shrink-0 rounded-md px-2.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)] ${selected ? 'bg-white text-[var(--salt-white)] shadow-sm' : 'text-[var(--salt-mist)] hover:text-[var(--salt-white)]'}`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onSearch}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--glass-border)] px-3 text-xs font-semibold text-[var(--salt-primary)] transition-colors hover:bg-[var(--glass-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
            >
              <Search className="h-3.5 w-3.5" aria-hidden />
              Search catalog
            </button>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                aria-label="Retry unavailable sources"
                title="Retry unavailable sources"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--glass-border)] text-[var(--salt-mist)] transition-colors hover:bg-[var(--glass-bg-hover)] hover:text-[var(--salt-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
              >
                <RotateCw className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </div>
        </div>
        <AudioAccessControl mode={mode} onChange={onModeChange} label="Filter by playback access" />
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
              <RotateCw className="h-4 w-4" aria-hidden />
              Try again
            </StatusButton>
          )}
          <StatusButton variant={onRetry ? 'secondary' : 'primary'} onClick={() => onNavigate('search')}>
            <Search className="h-4 w-4" aria-hidden />
            Search
          </StatusButton>
          <StatusButton variant="secondary" onClick={() => onNavigate('favorites')}>
            <Heart className="h-4 w-4 fill-current" aria-hidden />
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
          <Play className="h-4 w-4" aria-hidden />
          Show all audio
        </StatusButton>
      }
    />
  );
}

function EmptyDiscoverySelection({ onReset }: { onReset: () => void }) {
  return (
    <StatusPanel
      align="center"
      title="Nothing matches these filters"
      body="Try another source, vibe, or playback mode."
      actions={
        <StatusButton onClick={onReset}>
          <RotateCw className="h-4 w-4" aria-hidden />
          Clear filters
        </StatusButton>
      }
    />
  );
}

function DiscoverySongRow({
  song,
  playableTracks,
  artworkLoading = 'lazy',
  onNavigateWithItem,
}: {
  song: Song;
  playableTracks: Song[];
  artworkLoading?: 'eager' | 'lazy';
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
        <CoverArt src={song.coverArt} alt="" loading={artworkLoading} sizes="40px" className="h-10 w-10 object-cover" />
        <span
          aria-hidden
          className={`absolute inset-0 flex items-center justify-center bg-black/45 text-white transition-opacity ${unavailable ? 'opacity-0' : 'opacity-0 group-hover/art:opacity-100 group-focus-visible/art:opacity-100'}`}
        >
          <Play className="h-4 w-4" />
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
          <AudioAccessBadge song={song} />
        </span>
      </div>
      {unavailable && (
        <span
          title="Playback unavailable"
          aria-label="Playback unavailable"
          className="shrink-0 text-[var(--salt-mist)]"
        >
          <Lock className="h-3.5 w-3.5" aria-hidden />
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
    <VirtualGrid
      items={visibleSongs}
      estimateRowSize={56}
      minColumnWidth={320}
      columnGap={32}
      label="Discovery tracks"
      getItemKey={(song) => song.id}
      renderItem={(song, index) => (
        <DiscoverySongRow
          song={song}
          playableTracks={readySongs}
          artworkLoading={index < 3 ? 'eager' : 'lazy'}
          onNavigateWithItem={onNavigateWithItem}
        />
      )}
    />
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
            className={`marea-glass-card grid min-h-[104px] grid-cols-[80px_minmax(0,1fr)] gap-3 rounded-lg border p-2 transition-colors ${index >= 4 ? 'hidden sm:grid' : ''} ${active ? 'bg-[color-mix(in_srgb,var(--salt-primary)_7%,white)]' : ''}`}
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
                <Play className="h-5 w-5" />
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
                <Play className="h-6 w-6" />
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
                <Play className="h-3.5 w-3.5" />
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
            {unavailable && <Lock className="h-3.5 w-3.5 shrink-0 text-[var(--salt-mist)]" aria-hidden />}
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
        <ChevronRight
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
}: {
  onNavigateWithItem: (view: ViewType, item: NavigationItem | null) => void;
}) {
  const catalog = useMusicCatalog();
  const [activeKey, setActiveKey] = useState<ChartKey>(CHART_OPTIONS[0].key);
  const [isVisible, setIsVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = CHART_OPTIONS.find((option) => option.key === activeKey) ?? CHART_OPTIONS[0];

  useEffect(() => {
    if (isVisible) return;
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
  }, [isVisible]);

  const {
    data: queriedSongs = [],
    isPending: queryPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['new', 'chart', selected.key],
    queryFn: ({ signal }) => catalog.getChartSongs(selected.key, signal),
    staleTime: catalogStaleTime(countListResults),
    retry: 1,
    enabled: isVisible,
  });
  const songs = queriedSongs;
  const isPending = queryPending;

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
            <div className="marea-glass-surface flex min-h-28 flex-col items-center justify-center gap-2.5 rounded-lg border text-center text-[13px] text-[var(--salt-mist)]">
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
                <RotateCw className="h-4 w-4" aria-hidden />
                Retry
              </button>
            </div>
          )}
        </div>
      </Shelf>
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
  // The first listen should be dependable. Preview clips remain available via
  // the explicit All audio control, but discovery starts with tracks that can
  // play beyond a short licensed sample.
  const [accessMode, setAccessMode] = useState<AudioAccessMode>('full');
  const [sourceFilter, setSourceFilter] = useState<DiscoverySource>('all');
  const [vibeFilter, setVibeFilter] = useState<DiscoveryVibe>('all');

  const {
    genres,
    spotlightSongs,
    bestNewSongs,
    liveStations,
    releaseSongs,
    mainstreamSongs: chartSongs,
    hasCatalogFailure,
    isLoading: discoveryLoading,
    retry: retrySources,
    sections,
  } = useNewViewData();

  const catalogSongs = useMemo(
    () =>
      uniqueSongs(
        [bestNewSongs, spotlightSongs, releaseSongs, chartSongs, liveStations, ...Object.values(genres)].flat(),
      ),
    [bestNewSongs, chartSongs, genres, liveStations, releaseSongs, spotlightSongs],
  );
  const sourceOptions = useMemo(
    () =>
      Array.from(new Set(catalogSongs.map((song) => song.provider))).sort((left, right) => left.localeCompare(right)),
    [catalogSongs],
  );
  const activeSourceFilter: DiscoverySource =
    sourceFilter !== 'all' && sourceOptions.includes(sourceFilter) ? sourceFilter : 'all';

  const filteredBestNewSongs = useMemo(
    () => filterDiscoverySongs(bestNewSongs, accessMode, activeSourceFilter, vibeFilter).slice(0, 12),
    [accessMode, activeSourceFilter, bestNewSongs, vibeFilter],
  );
  const filteredSpotlightSongs = useMemo(() => {
    const directMatches = filterDiscoverySongs(spotlightSongs, accessMode, activeSourceFilter, vibeFilter).slice(0, 2);
    return directMatches.length > 0 ? directMatches : filteredBestNewSongs.slice(0, 2);
  }, [accessMode, activeSourceFilter, filteredBestNewSongs, spotlightSongs, vibeFilter]);
  const filteredReleaseSongs = useMemo(
    () => filterDiscoverySongs(releaseSongs, accessMode, activeSourceFilter, vibeFilter).slice(0, 10),
    [accessMode, activeSourceFilter, releaseSongs, vibeFilter],
  );
  const officialPreviewSongs = useMemo(
    () =>
      filterDiscoverySongs(
        releaseSongs.filter((song) => isPreviewSource(song.provider)),
        accessMode,
        activeSourceFilter,
        vibeFilter,
      ).slice(0, 12),
    [accessMode, activeSourceFilter, releaseSongs, vibeFilter],
  );
  const filteredMainstreamSongs = useMemo(
    () => filterDiscoverySongs(chartSongs, accessMode, activeSourceFilter, vibeFilter).slice(0, 12),
    [accessMode, activeSourceFilter, chartSongs, vibeFilter],
  );
  const liveAccessMode: AudioAccessMode = accessMode === 'preview' ? 'preview' : 'all';
  const filteredLiveStations = useMemo(
    () => filterDiscoverySongs(liveStations, liveAccessMode, activeSourceFilter, vibeFilter).slice(0, 12),
    [activeSourceFilter, liveAccessMode, liveStations, vibeFilter],
  );
  const heroSongs = useMemo(
    () => (filteredSpotlightSongs.length > 0 ? filteredSpotlightSongs : filteredReleaseSongs.slice(0, 2)),
    [filteredReleaseSongs, filteredSpotlightSongs],
  );
  const heroSongIds = useMemo(() => new Set(heroSongs.map((song) => song.id)), [heroSongs]);
  const mixCandidates = useMemo(
    () =>
      uniqueSongs(
        [bestNewSongs, chartSongs, genres.pop, genres.jazz, genres.remix, genres.classical, liveStations].flat(),
      ).filter((song) => !heroSongIds.has(song.id)),
    [bestNewSongs, chartSongs, genres.classical, genres.jazz, genres.pop, genres.remix, heroSongIds, liveStations],
  );
  const hasListeningSignals = history.length > 0 || favorites.length > 0;
  const smartMixes = useMemo<SmartMix[]>(() => {
    const presets: Array<{
      key: string;
      label: string;
      detail: string;
      vibe: DiscoveryVibe;
      icon: ReactNode;
      iconClassName: string;
    }> = [
      {
        key: 'marea',
        label: 'Marea mix',
        detail: hasListeningSignals ? 'Based on your listening' : 'A balanced first listen',
        vibe: 'all',
        icon: <Sparkles className="h-5 w-5" aria-hidden />,
        iconClassName: 'bg-[#eaf4f7] text-[var(--salt-primary)]',
      },
      {
        key: 'focus',
        label: 'Focus',
        detail: 'Steady, low-distraction sound',
        vibe: 'focus',
        icon: <Lightbulb className="h-5 w-5" aria-hidden />,
        iconClassName: 'bg-[#f0eefb] text-[#5b4ea2]',
      },
      {
        key: 'energy',
        label: 'Energy',
        detail: 'Upbeat picks for momentum',
        vibe: 'energy',
        icon: <Zap className="h-5 w-5" aria-hidden />,
        iconClassName: 'bg-[#fff1e4] text-[#9b5d20]',
      },
      {
        key: 'after-dark',
        label: 'After dark',
        detail: 'Late-night jazz and atmosphere',
        vibe: 'after-dark',
        icon: <Moon className="h-5 w-5" aria-hidden />,
        iconClassName: 'bg-[#eef1f5] text-[#3b5568]',
      },
    ];

    return presets
      .map((preset) => ({
        ...preset,
        songs: buildDiscoveryMixForAccess(
          history,
          favorites,
          mixCandidates.filter((song) => matchesDiscoveryLens(song, 'all', preset.vibe)),
          accessMode,
          12,
        ),
      }))
      .filter((mix) => mix.songs.length > 0);
  }, [accessMode, favorites, hasListeningSignals, history, mixCandidates]);
  const spotlightOrder = heroSongs.map((song) => song.id).join('|');
  const spotlightRailRef = useRef<HTMLDivElement>(null);
  const mastheadSongs = filteredBestNewSongs.length > 0 ? filteredBestNewSongs : heroSongs;

  useEffect(() => {
    if (spotlightRailRef.current) spotlightRailRef.current.scrollLeft = 0;
  }, [spotlightOrder]);

  const navigate = (view: ViewType) => {
    navigateTo(view);
    setCurrentView(view);
  };

  const genrePanels = useMemo(
    () =>
      [
        {
          title: 'Pop',
          view: 'pop' as const,
          songs: filterDiscoverySongs(genres.pop, accessMode, activeSourceFilter, vibeFilter).filter(isCuratableTitle),
        },
        {
          title: 'Jazz',
          view: 'jazz' as const,
          songs: filterDiscoverySongs(genres.jazz, accessMode, activeSourceFilter, vibeFilter).filter(isCuratableTitle),
        },
        {
          title: 'Remixes',
          view: 'remixes' as const,
          songs: filterDiscoverySongs(genres.remix, accessMode, activeSourceFilter, vibeFilter).filter(
            isCuratableTitle,
          ),
        },
        {
          title: 'Classical',
          view: 'classical' as const,
          songs: filterDiscoverySongs(genres.classical, accessMode, activeSourceFilter, vibeFilter).filter(
            isCuratableTitle,
          ),
        },
      ].filter(({ songs }) => songs.length > 0),
    [activeSourceFilter, accessMode, vibeFilter, genres.classical, genres.jazz, genres.pop, genres.remix],
  );
  const hasFilteredDiscovery =
    filteredSpotlightSongs.length > 0 ||
    filteredBestNewSongs.length > 0 ||
    filteredLiveStations.length > 0 ||
    filteredReleaseSongs.length > 0 ||
    genrePanels.length > 0;
  const hasAnyDiscovery = catalogSongs.length > 0;
  const hasActiveDiscoveryFilter = accessMode !== 'all' || activeSourceFilter !== 'all' || vibeFilter !== 'all';

  const resetDiscoveryFilters = () => {
    setAccessMode('all');
    setSourceFilter('all');
    setVibeFilter('all');
  };

  return (
    <motion.div initial="hidden" animate="shown" variants={STAGGER} className="space-y-7 pb-8 sm:space-y-9">
      <DiscoveryMasthead
        songs={mastheadSongs}
        mode={accessMode}
        onModeChange={setAccessMode}
        sourceOptions={sourceOptions}
        source={activeSourceFilter}
        onSourceChange={setSourceFilter}
        vibe={vibeFilter}
        onVibeChange={setVibeFilter}
        onSearch={() => navigate('search')}
        onRetry={hasCatalogFailure ? retrySources : undefined}
      />

      {history.length > 0 && (
        <Shelf
          title="Continue listening"
          view="history"
          action={<PlayShelfButton songs={history} label="Play recent tracks" />}
        >
          <SongRail
            songs={history.slice(0, 6)}
            label="Continue listening"
            showIndex={false}
            onNavigateWithItem={onNavigateWithItem}
          />
        </Shelf>
      )}

      {heroSongs.length > 0 ? (
        <div ref={spotlightRailRef}>
          <CinematicHero
            song={heroSongs[0]}
            eyebrow={heroSongs[0].metadataVerified ? 'Marea pick' : 'Chart watch'}
            onQueue={heroSongs[0].playbackUnavailable ? undefined : () => addToQueue(heroSongs[0])}
            onNavigateWithItem={onNavigateWithItem}
          />
          {heroSongs.length > 1 && (
            <Shelf title="Also in the spotlight">
              <div className="rail-scroll flex snap-x snap-mandatory scroll-pl-0 gap-3 overflow-x-auto [overflow-anchor:none] lg:grid lg:grid-cols-2 lg:gap-4 lg:overflow-visible">
                {heroSongs.slice(1).map((song) => (
                  <div key={song.id} className="w-[88%] max-w-[480px] shrink-0 snap-start lg:w-auto lg:max-w-none">
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
          hasActiveDiscoveryFilter ? (
            <EmptyDiscoverySelection onReset={resetDiscoveryFilters} />
          ) : (
            <EmptyAccessMode mode={accessMode} onModeChange={setAccessMode} />
          )
        ) : (
          <EmptyDiscovery onNavigate={navigate} onRetry={hasCatalogFailure ? retrySources : undefined} />
        )
      ) : null}

      <SmartMixShelf mixes={smartMixes} hasTaste={hasListeningSignals} />

      {filteredLiveStations.length > 0 ? (
        <Shelf title="Live right now" action={<PlayShelfButton songs={filteredLiveStations} label="Play live radio" />}>
          <LiveStationGrid songs={filteredLiveStations} onNavigateWithItem={onNavigateWithItem} />
        </Shelf>
      ) : sections.liveStations.isFetching ? (
        <Shelf title="Live right now">
          <RailSkeleton cells={4} />
        </Shelf>
      ) : null}

      {filteredBestNewSongs.length > 0 ? (
        <Shelf
          title="Songs making waves"
          view="trending"
          action={<PlayShelfButton songs={filteredBestNewSongs} label="Play the new music mix" />}
        >
          <DiscoverySongGrid songs={filteredBestNewSongs} onNavigateWithItem={onNavigateWithItem} />
        </Shelf>
      ) : sections.trending.isFetching || sections.pop.isFetching ? (
        <Shelf title="Songs making waves">
          <RailSkeleton cells={6} />
        </Shelf>
      ) : null}

      {filteredMainstreamSongs.length > 0 ? (
        <Shelf
          title="Mainstream chart picks"
          view="billboard"
          action={<PlayShelfButton songs={filteredMainstreamSongs} label="Play mainstream chart picks" />}
        >
          <DiscoverySongGrid songs={filteredMainstreamSongs} onNavigateWithItem={onNavigateWithItem} />
        </Shelf>
      ) : accessMode !== 'preview' && sections.chart.isFetching ? (
        <Shelf title="Mainstream chart picks">
          <RailSkeleton cells={6} />
        </Shelf>
      ) : null}

      {officialPreviewSongs.length > 0 && (
        <Shelf
          title="Official preview picks"
          action={<PlayShelfButton songs={officialPreviewSongs} label="Play official preview picks" />}
        >
          <DiscoverySongGrid songs={officialPreviewSongs} onNavigateWithItem={onNavigateWithItem} />
        </Shelf>
      )}

      {filteredReleaseSongs.length > 0 && (
        <Shelf title="New records to explore" view="albums">
          <ReleaseRail songs={filteredReleaseSongs} onNavigateWithItem={onNavigateWithItem} />
        </Shelf>
      )}

      {genrePanels.length > 0 ? (
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
      ) : sections.pop.isFetching ||
        sections.jazz.isFetching ||
        sections.remix.isFetching ||
        sections.classical.isFetching ? (
        <Shelf title="Fresh by genre">
          <SectionLoading rows={4} />
        </Shelf>
      ) : null}

      {accessMode !== 'full' && <ChartPreview onNavigateWithItem={onNavigateWithItem} />}

      <Shelf title="Explore Marea">
        <ExploreGrid />
      </Shelf>
    </motion.div>
  );
}
