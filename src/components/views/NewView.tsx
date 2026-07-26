'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  HiArrowPath,
  HiArrowRight,
  HiChartBar,
  HiClock,
  HiExclamationTriangle,
  HiHeart,
  HiLockClosed,
  HiMagnifyingGlass,
  HiMusicalNote,
  HiPlay,
  HiPlus,
  HiSquares2X2,
  HiUserGroup,
} from 'react-icons/hi2';
import { usePlayerStore } from '@/store/playerStore';
import { ArtistLink, ChartRail, FavoriteButton, SongRail, formatDuration } from './SongCard';
import { EditorialBanner } from './EditorialBanner';
import { CoverArt } from '@/components/ui/CoverArt';
import { buildNavigationUrl, type NavigationItem } from '@/lib/navigation';
import { catalogStaleTime, countListResults } from '@/lib/catalogFreshness';
import { interleaveSongGroups, playableSongs, uniqueAlbumSongs } from './newViewModel';
import type { FederatedResult } from '@/lib/api';
import type { Song, ViewType } from '@/types/music';

interface SectionProps {
  title: string;
  description?: string;
  view?: ViewType;
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

function Section({ title, description, view, children }: SectionProps) {
  const setCurrentView = usePlayerStore((state) => state.setCurrentView);
  const openSection = () => {
    if (!view) return;
    navigateTo(view);
    setCurrentView(view);
  };

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-4 border-b border-[var(--glass-border)] pb-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold leading-tight text-[var(--salt-white)] sm:text-2xl">{title}</h2>
          {description && <p className="mt-1 text-xs text-[var(--salt-mist)]">{description}</p>}
        </div>
        {view && (
          <button
            type="button"
            onClick={openSection}
            className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-semibold text-[var(--salt-primary)] transition-colors hover:bg-[var(--glass-bg-hover)]"
          >
            See all
            <HiArrowRight className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function SectionLoading({ rows = 6 }: { rows?: number }) {
  return (
    <div className="grid gap-x-6 md:grid-cols-2 xl:grid-cols-3" aria-label="Loading music">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex h-16 items-center gap-3 border-b border-[var(--glass-border)] px-1">
          <div className="h-10 w-10 shrink-0 animate-pulse rounded-lg bg-[var(--salt-ghost)]" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 w-3/4 animate-pulse rounded bg-[var(--salt-ghost)]" />
            <div className="h-2.5 w-1/2 animate-pulse rounded bg-[var(--salt-ghost)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

function DiscoveryIntro({ songs }: { songs: Song[] }) {
  const playAlbum = usePlayerStore((state) => state.playAlbum);
  const readySongs = playableSongs(songs);
  const sourceCount = new Set(songs.map((song) => song.provider)).size;

  return (
    <section className="flex items-end justify-between gap-3 border-b border-[var(--glass-border)] pb-5 sm:gap-4 sm:pb-6">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase text-[#bd3f4f]">Marea selection</p>
        <h2 className="mt-1 text-3xl font-bold leading-tight text-[var(--salt-white)] sm:text-4xl">New and noteworthy</h2>
        <p className="mt-2 text-sm text-[var(--salt-mist)]">
          {songs.length > 0
            ? `${songs.length} picks across ${sourceCount} ${sourceCount === 1 ? 'source' : 'sources'}`
            : 'Fresh catalogs update here throughout the day'}
        </p>
      </div>
      <button
        type="button"
        onClick={() => playAlbum(readySongs, 0)}
        disabled={readySongs.length === 0}
        aria-label="Play the new music mix"
        title="Play the mix"
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center gap-2 rounded-full bg-[#d84f5f] text-sm font-semibold text-white shadow-[0_8px_20px_rgba(184,55,73,0.2)] transition-colors hover:bg-[#bd3f4f] disabled:cursor-not-allowed disabled:bg-[#a7b3ba] disabled:shadow-none sm:w-fit sm:px-5"
      >
        <HiPlay className="h-4 w-4" aria-hidden />
        <span className="hidden sm:inline">Play the mix</span>
      </button>
    </section>
  );
}

function CatalogNotice({ issues, onRetry }: { issues: string[]; onRetry: () => void }) {
  if (!issues.length) return null;
  const mobileSummary = issues.length === 1
    ? '1 catalog feed affected. Showing available music.'
    : `${issues.length} catalog feeds affected. Showing available music.`;

  return (
    <div role="status" className="flex items-center gap-2 border-y border-[#dfb5b8] bg-[#fff6f6] px-3 py-2.5 text-sm text-[#77343d] sm:gap-3 sm:px-4 sm:py-3">
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <HiExclamationTriangle className="h-5 w-5 shrink-0" aria-hidden />
        <span className="min-w-0 sm:hidden">{mobileSummary}</span>
        <span className="hidden min-w-0 sm:inline">Affected feeds: {issues.join(', ')}. Available music remains in place.</span>
      </span>
      <button
        type="button"
        onClick={onRetry}
        aria-label="Retry unavailable sources"
        title="Retry unavailable sources"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold hover:bg-[#f8e4e5] sm:w-auto sm:gap-2 sm:px-3"
      >
        <HiArrowPath className="h-4 w-4" aria-hidden />
        <span className="hidden sm:inline">Retry sources</span>
      </button>
    </div>
  );
}

function EmptyDiscovery({ onNavigate }: { onNavigate: (view: ViewType) => void }) {
  return (
    <section className="grid min-h-[260px] place-items-center border-y border-[var(--glass-border)] py-10 text-center" role="status">
      <div className="max-w-lg">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#eaf4f7] text-[var(--salt-primary)]">
          <HiMusicalNote className="h-6 w-6" aria-hidden />
        </span>
        <h2 className="mt-4 text-xl font-bold text-[var(--salt-white)]">The live catalog is catching up</h2>
        <p className="mt-2 text-sm text-[var(--salt-mist)]">Your saved music is still ready, or search for a specific artist or track.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => onNavigate('search')} className="inline-flex h-10 items-center gap-2 rounded-full bg-[var(--salt-primary)] px-4 text-sm font-semibold text-white">
            <HiMagnifyingGlass className="h-4 w-4" aria-hidden />
            Search
          </button>
          <button type="button" onClick={() => onNavigate('favorites')} className="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--glass-border-active)] px-4 text-sm font-semibold text-[var(--salt-primary)]">
            <HiHeart className="h-4 w-4" aria-hidden />
            Favorites
          </button>
        </div>
      </div>
    </section>
  );
}

function DiscoverySongRow({ song, rank, playableTracks, onNavigateWithItem }: { song: Song; rank: number; playableTracks: Song[]; onNavigateWithItem: (view: ViewType, item: NavigationItem | null) => void }) {
  const playAlbum = usePlayerStore((state) => state.playAlbum);
  const addToQueue = usePlayerStore((state) => state.addToQueue);
  const currentSong = usePlayerStore((state) => state.currentSong);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const playableIndex = playableTracks.findIndex((track) => track.id === song.id);
  const unavailable = playableIndex < 0;
  const active = currentSong?.id === song.id;

  return (
    <article className={`grid h-16 grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 border-b border-[var(--glass-border)] px-1 transition-colors ${active ? 'bg-[#eef8fb]' : 'hover:bg-white/55'}`}>
      <span className={`text-center text-xs font-semibold tabular-nums ${active ? 'text-[#bd3f4f]' : 'text-[var(--salt-mist)]'}`} aria-label={`Track ${rank}`}>
        {active && isPlaying ? <span className="inline-block h-2 w-2 rounded-full bg-[#d84f5f]" aria-label="Playing" /> : rank}
      </span>
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={() => { if (!unavailable) playAlbum(playableTracks, playableIndex); }}
          disabled={unavailable}
          aria-label={unavailable ? `${song.title} playback unavailable` : `Play ${song.title} by ${song.artist}`}
          className="shrink-0 rounded-lg disabled:cursor-not-allowed"
        >
          <CoverArt src={song.coverArt} alt="" loading="lazy" sizes="40px" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
        </button>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => { if (!unavailable) playAlbum(playableTracks, playableIndex); }}
            disabled={unavailable}
            aria-label={unavailable ? `${song.title} playback unavailable` : `Play ${song.title} by ${song.artist}`}
            className={`block w-full truncate text-left text-sm font-semibold disabled:cursor-not-allowed ${active ? 'text-[#a93748]' : 'text-[var(--salt-white)]'}`}
          >
            {song.title}
          </button>
          <ArtistLink song={song} onNavigateWithItem={onNavigateWithItem} className="block text-xs text-[var(--salt-mist)]" />
          <span className="hidden truncate text-[10px] text-[var(--salt-foam)] sm:block">{formatDuration(song.duration)} · {song.provider} - {song.licenseName || 'Provider terms'}</span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <FavoriteButton song={song} className="h-9 w-9" />
        {unavailable ? (
          <span title="Playback unavailable" aria-label="Playback unavailable" className="flex h-9 w-9 shrink-0 items-center justify-center text-[var(--salt-mist)]">
            <HiLockClosed className="h-4 w-4" aria-hidden />
          </span>
        ) : (
          <button
            type="button"
            onClick={() => addToQueue(song)}
            title="Add to queue"
            aria-label={`Add ${song.title} to queue`}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--salt-primary)] transition-colors hover:bg-[#dceef5]"
          >
            <HiPlus className="h-5 w-5" aria-hidden />
          </button>
        )}
      </div>
    </article>
  );
}

function DiscoverySongGrid({ songs, onNavigateWithItem }: { songs: Song[]; onNavigateWithItem: (view: ViewType, item: NavigationItem | null) => void }) {
  const readySongs = playableSongs(songs);
  return (
    <div className="grid gap-x-6 md:grid-cols-2 xl:grid-cols-3">
      {songs.map((song, index) => (
        <DiscoverySongRow key={song.id} song={song} rank={index + 1} playableTracks={readySongs} onNavigateWithItem={onNavigateWithItem} />
      ))}
    </div>
  );
}

function ReleaseRail({ songs, onNavigateWithItem }: { songs: Song[]; onNavigateWithItem: (view: ViewType, item: NavigationItem | null) => void }) {
  return (
    <div className="-mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 pb-3" aria-label="New releases">
      {songs.map((song, index) => (
        <article key={song.albumId} className="w-[152px] shrink-0 snap-start sm:w-[178px]">
          <button
            type="button"
            onClick={() => onNavigateWithItem('albums', { kind: 'album', id: song.albumId })}
            className="group block w-full rounded-lg text-left focus-visible:ring-2 focus-visible:ring-[var(--salt-primary)]"
            aria-label={`Open ${song.album || song.title} by ${song.artist}`}
          >
            <span className="relative block aspect-square overflow-hidden rounded-lg bg-[var(--salt-ghost)] shadow-[0_10px_26px_rgba(47,119,157,0.14)]">
              <CoverArt
                src={song.coverArt}
                alt=""
                loading={index === 0 ? 'eager' : 'lazy'}
                sizes="(max-width: 640px) 152px, 178px"
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.025]"
              />
            </span>
            <span className="mt-3 block truncate text-sm font-semibold text-[var(--salt-white)]">{song.album || song.title}</span>
            <span className="mt-0.5 block truncate text-xs text-[var(--salt-mist)]">{song.artist}</span>
          </button>
        </article>
      ))}
    </div>
  );
}

function MiniSongList({ songs, onNavigateWithItem }: { songs: Song[]; onNavigateWithItem: (view: ViewType, item: NavigationItem | null) => void }) {
  const playAlbum = usePlayerStore((state) => state.playAlbum);
  const readySongs = playableSongs(songs);

  return (
    <div className="mt-2">
      {songs.slice(0, 4).map((song) => {
        const index = readySongs.findIndex((track) => track.id === song.id);
        const unavailable = index < 0;
        return (
          <div key={song.id} className="flex h-12 w-full min-w-0 items-center gap-2 border-b border-[var(--glass-border)]">
            <button
              type="button"
              disabled={unavailable}
              onClick={() => { if (!unavailable) playAlbum(readySongs, index); }}
              aria-label={unavailable ? `${song.title} playback unavailable` : `Play ${song.title}`}
              className="shrink-0 disabled:cursor-not-allowed"
            >
              <CoverArt src={song.coverArt} alt="" loading="lazy" sizes="36px" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
            </button>
            <div className="min-w-0 flex-1">
              <button
                type="button"
                disabled={unavailable}
                onClick={() => { if (!unavailable) playAlbum(readySongs, index); }}
                aria-label={unavailable ? `${song.title} playback unavailable` : `Play ${song.title}`}
                className="block w-full truncate text-left text-xs font-semibold text-[var(--salt-white)] disabled:cursor-not-allowed"
              >
                {song.title}
              </button>
              <ArtistLink song={song} onNavigateWithItem={onNavigateWithItem} className="block text-[11px] text-[var(--salt-mist)]" />
            </div>
            <FavoriteButton song={song} className="h-8 w-8 shrink-0" />
            {unavailable ? <HiLockClosed className="h-4 w-4 shrink-0 text-[var(--salt-mist)]" aria-hidden /> : <HiPlay className="h-4 w-4 shrink-0 text-[var(--salt-primary)]" aria-hidden />}
          </div>
        );
      })}
    </div>
  );
}

function GenrePanel({ title, view, songs, onNavigateWithItem }: { title: string; view: ViewType; songs: Song[]; onNavigateWithItem: (view: ViewType, item: NavigationItem | null) => void }) {
  const setCurrentView = usePlayerStore((state) => state.setCurrentView);
  return (
    <section className="min-w-0 border-t-2 border-[#c7dce6] pt-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="min-w-0 truncate text-base font-bold text-[var(--salt-white)]">{title}</h3>
        <button type="button" onClick={() => { navigateTo(view); setCurrentView(view); }} aria-label={`Open ${title}`} className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--salt-primary)] hover:bg-[var(--glass-bg-hover)]">
          <HiArrowRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <MiniSongList songs={songs} onNavigateWithItem={onNavigateWithItem} />
    </section>
  );
}

function ChartPreview({ options, onNavigateWithItem }: { options: ChartOption[]; onNavigateWithItem: (view: ViewType, item: NavigationItem | null) => void }) {
  const [activeKey, setActiveKey] = useState<ChartKey>(options[0].key);
  const selected = options.find((option) => option.key === activeKey) ?? options[0];

  return (
    <Section title="Chart watch" description="A quick read on the US, UK, and Japan" view={selected.view}>
      <div className="inline-flex max-w-full gap-1 overflow-x-auto rounded-full border border-[var(--glass-border)] bg-white/60 p-1" role="tablist" aria-label="Choose chart">
        {options.map((option) => {
          const active = option.key === selected.key;
          return (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveKey(option.key)}
              className={`h-9 shrink-0 rounded-full px-4 text-xs font-semibold transition-colors ${active ? 'bg-[#17394f] text-white' : 'text-[var(--salt-mist)] hover:bg-white'}`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" aria-label={`${selected.label} preview`}>
        {selected.isLoading ? <SectionLoading rows={6} /> : selected.songs.length > 0 ? (
          <ChartRail songs={selected.songs.slice(0, 6)} label={`${selected.label} chart`} onNavigateWithItem={onNavigateWithItem} />
        ) : (
          <div className="flex min-h-32 flex-col items-center justify-center gap-3 border-y border-[var(--glass-border)] text-center text-sm text-[var(--salt-mist)]">
            <p>{selected.isError ? `${selected.label} is temporarily unavailable.` : `No ${selected.label} entries are available.`}</p>
            <button type="button" onClick={selected.refetch} className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-xs font-semibold text-[var(--salt-primary)] hover:bg-[var(--glass-bg-hover)]">
              <HiArrowPath className="h-4 w-4" aria-hidden />
              Retry
            </button>
          </div>
        )}
      </div>
    </Section>
  );
}

function ExploreGrid({ lxEnabled }: { lxEnabled: boolean }) {
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
    ...(lxEnabled ? [{ view: 'billboard' as const, icon: <HiChartBar />, label: 'Charts' }] : []),
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {items.map(({ view, icon, label }) => (
        <button
          key={view}
          type="button"
          onClick={() => navigate(view)}
          className="flex h-14 items-center gap-3 rounded-lg border border-[var(--glass-border)] bg-white/55 px-3 text-left text-sm font-semibold text-[var(--salt-white)] transition-colors hover:border-[var(--glass-border-active)] hover:bg-white"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e7f2f6] text-lg text-[var(--salt-primary)]" aria-hidden>{icon}</span>
          <span className="truncate">{label}</span>
        </button>
      ))}
    </div>
  );
}

function useChart(key: string[], chart: ChartKey, enabled: boolean) {
  return useQuery({
    queryKey: key,
    queryFn: async ({ signal }): Promise<Song[]> => {
      const { api } = await import('@/lib/api');
      return api.getChartSongs(chart, signal);
    },
    enabled,
    staleTime: catalogStaleTime(countListResults),
    retry: 1,
  });
}

function useJamendo(key: string[], tag: string) {
  return useQuery({
    queryKey: key,
    queryFn: async ({ signal }): Promise<Song[]> => {
      const { api } = await import('@/lib/api');
      return api.getSongsByTag(tag, 30, signal);
    },
    staleTime: catalogStaleTime(countListResults),
    retry: 1,
  });
}

function useTrending() {
  return useQuery({
    queryKey: ['new', 'trending'],
    queryFn: async ({ signal }): Promise<FederatedResult<Song>> => {
      const { api } = await import('@/lib/api');
      return api.getTrending(30, signal);
    },
    staleTime: catalogStaleTime(countListResults),
    retry: 1,
  });
}

function useCCMixter(key: string[], tag: string) {
  return useQuery({
    queryKey: key,
    queryFn: async ({ signal }): Promise<FederatedResult<Song>> => {
      const { api } = await import('@/lib/api');
      return api.getCcmixterSongsByTag(tag, 30, signal);
    },
    staleTime: catalogStaleTime(countListResults),
    retry: 1,
  });
}

function collectUnavailable(result: FederatedResult<Song> | undefined, issues: Set<string>): void {
  if (!result) return;
  for (const provider of result.failedProviders) issues.add(provider);
  for (const provider of result.degradedProviders ?? []) issues.add(provider);
}

export function NewView({ onNavigateWithItem }: { onNavigateWithItem: (view: ViewType, item: NavigationItem | null) => void }) {
  const history = usePlayerStore((state) => state.history);
  const addToQueue = usePlayerStore((state) => state.addToQueue);
  const setCurrentView = usePlayerStore((state) => state.setCurrentView);
  const lxEnabled = process.env.NEXT_PUBLIC_LX_ENABLED === 'true';

  const trending = useTrending();
  const pop = useJamendo(['new', 'featured'], 'pop');
  const jazz = useCCMixter(['new', 'jazz'], 'jazz');
  const remix = useCCMixter(['new', 'remix'], 'remix');
  const classical = useJamendo(['new', 'classical'], 'classical');
  const billboard = useChart(['new', 'billboard'], 'billboard', lxEnabled);
  const uk = useChart(['new', 'uk'], 'uk', lxEnabled);
  const jp = useChart(['new', 'jp'], 'jp', lxEnabled);

  const verifiedMix = interleaveSongGroups([
    pop.data,
    trending.data?.results,
    jazz.data?.results,
    remix.data?.results,
    classical.data,
  ], 48);
  const discoveryMix = interleaveSongGroups([
    pop.data,
    billboard.data,
    trending.data?.results,
    jp.data,
    jazz.data?.results,
    uk.data,
    remix.data?.results,
    classical.data,
  ], 60);
  const spotlightSongs = interleaveSongGroups([
    pop.data,
    trending.data?.results,
    billboard.data,
    jp.data,
    uk.data,
    jazz.data?.results,
    remix.data?.results,
  ], 2);
  const spotlightOrder = spotlightSongs.map((song) => song.id).join('|');
  const spotlightRailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (spotlightRailRef.current) spotlightRailRef.current.scrollLeft = 0;
  }, [spotlightOrder]);

  const bestNewSongs = interleaveSongGroups([
    billboard.data,
    jp.data,
    trending.data?.results,
    pop.data,
    uk.data,
    jazz.data?.results,
    remix.data?.results,
    classical.data,
  ], 12);
  const releaseSongs = uniqueAlbumSongs(verifiedMix, 10);

  const issues = new Set<string>();
  if (pop.isError || classical.isError) issues.add('Jamendo');
  if (jazz.isError || remix.isError) issues.add('ccMixter');
  collectUnavailable(trending.data, issues);
  collectUnavailable(jazz.data, issues);
  collectUnavailable(remix.data, issues);
  if (lxEnabled && (billboard.isError || uk.isError || jp.isError)) issues.add('LX Music');
  const unavailableSources = [...issues];

  const relevantQueries = lxEnabled
    ? [trending, pop, jazz, remix, classical, billboard, uk, jp]
    : [trending, pop, jazz, remix, classical];
  const discoveryLoading = relevantQueries.some((query) => query.isPending || query.isFetching);

  const retrySources = () => {
    void Promise.all(relevantQueries.map((query) => query.refetch()));
  };
  const navigate = (view: ViewType) => {
    navigateTo(view);
    setCurrentView(view);
  };

  const genrePanels = [
    { title: 'Pop', view: 'pop' as const, songs: pop.data ?? [] },
    { title: 'Jazz', view: 'jazz' as const, songs: jazz.data?.results ?? [] },
    { title: 'Remixes', view: 'remixes' as const, songs: remix.data?.results ?? [] },
    { title: 'Classical', view: 'classical' as const, songs: classical.data ?? [] },
  ].filter(({ songs }) => songs.length > 0);

  const chartOptions: ChartOption[] = [
    { key: 'billboard', label: 'United States', view: 'billboard', songs: billboard.data ?? [], isLoading: billboard.isPending, isError: billboard.isError, refetch: () => void billboard.refetch() },
    { key: 'uk', label: 'United Kingdom', view: 'uk', songs: uk.data ?? [], isLoading: uk.isPending, isError: uk.isError, refetch: () => void uk.refetch() },
    { key: 'jp', label: 'Japan', view: 'jp', songs: jp.data ?? [], isLoading: jp.isPending, isError: jp.isError, refetch: () => void jp.refetch() },
  ];

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-8 pb-8 pt-6 sm:space-y-12 sm:pt-8">
      <DiscoveryIntro songs={discoveryMix} />
      <CatalogNotice issues={unavailableSources} onRetry={retrySources} />

      {spotlightSongs.length > 0 ? (
        <Section title="In the spotlight" description="Editorial picks and chart movement">
          <div ref={spotlightRailRef} className={spotlightSongs.length > 1
            ? 'flex snap-x snap-mandatory scroll-pl-0 gap-3 overflow-x-auto pb-2 [overflow-anchor:none] lg:grid lg:grid-cols-[1.15fr_0.85fr] lg:gap-4 lg:overflow-visible lg:pb-0'
            : 'grid'}>
            {spotlightSongs.map((song, index) => (
              <div key={song.id} className={spotlightSongs.length > 1 ? 'w-[84%] max-w-[520px] shrink-0 snap-start lg:w-auto lg:max-w-none' : ''}>
                <EditorialBanner
                  song={song}
                  eyebrow={song.metadataVerified ? (index === 0 ? 'Marea pick' : 'New release') : 'Chart watch'}
                  // Both spotlight cards share the fold on wide viewports, so
                  // either can become the LCP element.
                  eager
                  onQueue={song.playbackUnavailable ? undefined : () => addToQueue(song)}
                />
              </div>
            ))}
          </div>
        </Section>
      ) : discoveryLoading ? (
        <Section title="In the spotlight" description="Loading the latest catalog updates">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="aspect-[16/9] animate-pulse rounded-lg bg-[var(--salt-ghost)]" />
            <div className="aspect-[16/9] animate-pulse rounded-lg bg-[var(--salt-ghost)]" />
          </div>
        </Section>
      ) : <EmptyDiscovery onNavigate={navigate} />}

      {bestNewSongs.length > 0 && (
        <Section title="Songs making waves" description="A cross-source queue, ready in one click" view="trending">
          <DiscoverySongGrid songs={bestNewSongs} onNavigateWithItem={onNavigateWithItem} />
        </Section>
      )}

      {history.length > 0 && (
        <Section title="Continue listening" description="Pick up where you left off" view="history">
          <SongRail songs={history.slice(0, 8)} label="Recently played" onNavigateWithItem={onNavigateWithItem} />
        </Section>
      )}

      {releaseSongs.length > 0 && (
        <Section title="New records to explore" description="Open an album for its complete verified track list" view="albums">
          <ReleaseRail songs={releaseSongs} onNavigateWithItem={onNavigateWithItem} />
        </Section>
      )}

      {genrePanels.length > 0 && (
        <Section title="Fresh by genre" description="Four quick picks from each collection">
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {genrePanels.map((panel) => <GenrePanel key={panel.view} {...panel} onNavigateWithItem={onNavigateWithItem} />)}
          </div>
        </Section>
      )}

      {lxEnabled && <ChartPreview options={chartOptions} onNavigateWithItem={onNavigateWithItem} />}

      <Section title="Explore Marea">
        <ExploreGrid lxEnabled={lxEnabled} />
      </Section>
    </div>
  );
}
