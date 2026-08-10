import { describe, expect, it } from 'vitest';
import type { Album, Artist, Song } from '@/types/music';
import {
  areAllSearchProvidersUnavailable,
  rankSearchAlbums,
  rankSearchArtists,
  rankSearchSongs,
  rankSearchSongsForAccess,
  splitTopSearchMatches,
  summarizeSearchProviders,
} from './searchViewModel';

function song(id: string, overrides: Partial<Song> = {}): Song {
  return {
    id,
    title: 'Cruel Summer',
    artist: 'Taylor Swift',
    artistId: 'artist-1',
    album: 'Lover',
    albumId: 'album-1',
    coverArt: '/placeholder-album.svg',
    duration: 210,
    track: 1,
    year: 2019,
    genre: 'Pop',
    path: `/music/${id}.mp3`,
    bitRate: 320,
    contentType: 'audio/mpeg',
    suffix: 'mp3',
    size: 1,
    provider: 'Audius',
    sourceUrl: 'https://example.com/source',
    creatorUrl: 'https://example.com/artist',
    licenseName: 'Creator-published stream',
    licenseUrl: 'https://example.com/license',
    attributionUrl: 'https://example.com/source',
    metadataVerified: true,
    ...overrides,
  };
}

function artist(id: string, name: string): Artist {
  return { id, name, coverArt: '/placeholder-album.svg', albumCount: 1 };
}

function album(id: string, name: string, artistName: string): Album {
  return {
    id,
    name,
    artist: artistName,
    artistId: `${id}-artist`,
    coverArt: '/placeholder-album.svg',
    songCount: 10,
    duration: 1_800,
    year: 2024,
    genre: 'Pop',
  };
}

describe('search view model', () => {
  it('ranks an original recording above covers for a combined artist and Japanese title query', () => {
    const original = song('itunes-original', {
      provider: 'Apple Preview',
      title: '\u591c\u306b\u99c6\u3051\u308b',
      artist: 'YOASOBI',
      duration: 30,
    });
    const musicBoxCover = song('deezer-music-box', {
      provider: 'Deezer Preview',
      title: '\u591c\u306b\u99c6\u3051\u308b (YOASOBI)',
      artist: '\u30b3\u30ed\u30e0\u30d3\u30a2\u30aa\u30eb\u30b4\u30fc\u30eb',
      duration: 30,
    });
    const karaokeCover = song('itunes-karaoke', {
      provider: 'Apple Preview',
      title: '\u591c\u306b\u99c6\u3051\u308b \u30ab\u30e9\u30aa\u30b1',
      artist: '\u6b4c\u3063\u3061\u3083\u738b',
      duration: 30,
    });

    expect(
      rankSearchSongs([musicBoxCover, karaokeCover, original], 'YOASOBI \u591c\u306b\u99c6\u3051\u308b').map(
        ({ id }) => id,
      ),
    ).toEqual(['itunes-original', 'deezer-music-box', 'itunes-karaoke']);
  });

  it('prioritizes an exact artist match over an unrelated track named after the artist', () => {
    const namedAfterArtist = song('audius-title', { title: 'Taylor Swift', artist: 'Someone Else' });
    const officialArtistMatch = song('itunes-artist', { provider: 'Apple Preview', duration: 30 });

    expect(rankSearchSongs([namedAfterArtist, officialArtistMatch], 'Taylor Swift').map(({ id }) => id)).toEqual([
      'itunes-artist',
      'audius-title',
    ]);
  });

  it('uses repeated exact artist evidence to beat an equal-provider title collision', () => {
    const titleCollision = song('itunes-title-collision', {
      provider: 'Apple Preview',
      title: 'YOASOBI',
      artist: 'KIRA & 下拓',
      duration: 30,
    });
    const firstArtistTrack = song('itunes-artist-track-1', {
      provider: 'Apple Preview',
      title: '夜に駆ける',
      artist: 'YOASOBI',
      duration: 30,
      recordingDuration: 261,
    });
    const secondArtistTrack = song('itunes-artist-track-2', {
      provider: 'Apple Preview',
      title: '怪物',
      artist: 'YOASOBI',
      duration: 30,
      recordingDuration: 222,
    });

    expect(
      rankSearchSongs([titleCollision, firstArtistTrack, secondArtistTrack], 'YOASOBI').map(({ id }) => id),
    ).toEqual(['itunes-artist-track-1', 'itunes-artist-track-2', 'itunes-title-collision']);
  });

  it('prioritizes an exact song title over a track whose artist has that name', () => {
    const artistNameCollision = song('audius-collision', {
      title: 'Suicide Blonde',
      artist: 'Blinding Lights',
    });
    const exactTitle = song('itunes-blinding-lights', {
      title: 'Blinding Lights',
      artist: 'The Weeknd',
      provider: 'Apple Preview',
      duration: 30,
    });

    expect(rankSearchSongs([artistNameCollision, exactTitle], 'Blinding Lights').map(({ id }) => id)).toEqual([
      'itunes-blinding-lights',
      'audius-collision',
    ]);
  });

  it('keeps an exact Japanese artist above a noisy title prefix from another artist', () => {
    const noisyTitle = song('kuwo-noisy', {
      title: 'YOASOBI小说歌者100%的灵魂传递',
      artist: '乐见大牌&YOASOBI',
      provider: 'Kuwo',
      metadataVerified: false,
    });
    const exactArtist = song('kuwo-exact-artist', {
      title: '怪物',
      artist: 'YOASOBI',
      provider: 'Kuwo',
      metadataVerified: false,
    });

    expect(rankSearchSongs([noisyTitle, exactArtist], 'YOASOBI').map(({ id }) => id)).toEqual([
      'kuwo-exact-artist',
      'kuwo-noisy',
    ]);
  });

  it('prefers a resolver track by the exact artist over a resolver title named after that artist', () => {
    const titleCollision = song('kuwo-title-collision', {
      title: 'YOASOBI',
      artist: 'Fan upload',
      provider: 'Kuwo',
      metadataVerified: false,
    });
    const exactArtist = song('kuwo-exact-artist-recording', {
      title: 'Monster',
      artist: 'YOASOBI',
      provider: 'Kuwo',
      metadataVerified: false,
    });

    expect(rankSearchSongs([titleCollision, exactArtist], 'YOASOBI').map(({ id }) => id)).toEqual([
      'kuwo-exact-artist-recording',
      'kuwo-title-collision',
    ]);
  });

  it('uses cross-provider identity evidence for full-track same-title collisions', () => {
    const apple = song('itunes-iris-out', {
      provider: 'Apple Preview',
      title: 'IRIS OUT',
      artist: 'Kenshi Yonezu',
      duration: 30,
      recordingDuration: 152,
    });
    const deezer = song('deezer-iris-out', {
      provider: 'Deezer Preview',
      title: 'IRIS OUT',
      artist: 'Kenshi Yonezu',
      duration: 30,
      recordingDuration: 151,
    });
    const lxMatch = song('lxmusic-iris-out', {
      provider: 'LX Music',
      title: 'IRIS OUT',
      artist: 'Kenshi Yonezu',
      duration: 152,
      metadataVerified: true,
    });
    const sameTitleAlternative = song('kuwo-rime-iris-out', {
      provider: 'Kuwo',
      title: 'IRIS OUT',
      artist: 'rime',
      duration: 149,
      metadataVerified: false,
    });

    expect(
      rankSearchSongsForAccess([sameTitleAlternative, apple, deezer, lxMatch], 'IRIS OUT', 'full').map(({ id }) => id),
    ).toEqual(['lxmusic-iris-out', 'kuwo-rime-iris-out']);
  });

  it('keeps a full upload with the known Japanese artist above exact-title covers', () => {
    const apple = song('itunes-yoru-ni-kakeru', {
      provider: 'Apple Preview',
      title: '夜に駆ける',
      artist: 'YOASOBI',
      duration: 30,
      recordingDuration: 261,
    });
    const deezer = song('deezer-yoru-ni-kakeru', {
      provider: 'Deezer Preview',
      title: '夜に駆ける',
      artist: 'YOASOBI',
      duration: 30,
      recordingDuration: 261,
    });
    const cover = song('kuwo-yoru-cover', {
      provider: 'Kuwo',
      title: '夜に駆ける',
      artist: 'Amelia Khor',
      duration: 269,
      metadataVerified: false,
    });
    const taggedUpload = song('audius-yoru-tagged', {
      provider: 'Audius',
      title: '夜に駆ける - YOASOBI',
      artist: 'Myeong Kyu',
      duration: 259,
      metadataVerified: true,
    });

    expect(
      rankSearchSongsForAccess([cover, apple, deezer, taggedUpload], '夜に駆ける', 'full').map(({ id }) => id),
    ).toEqual(['audius-yoru-tagged', 'kuwo-yoru-cover']);
  });

  it('prefers a clean mainstream resolver identity over an open duplicate', () => {
    const archive = song('archive-idol', {
      provider: 'Archive',
      title: 'Idol',
      artist: 'YOASOBI',
      duration: 213,
    });
    const kuwo = song('kuwo-idol', {
      provider: 'Kuwo',
      title: 'Idol',
      artist: 'YOASOBI',
      duration: 213,
      metadataVerified: false,
    });

    expect(rankSearchSongsForAccess([archive, kuwo], 'Idol', 'full').map(({ id }) => id)).toEqual(['kuwo-idol']);
  });

  it('keeps mainstream resolver identities ahead of open uploads in a full artist search', () => {
    const archive = song('archive-yoasobi-upload', {
      provider: 'Archive',
      title: '三原色',
      artist: 'YOASOBI',
      duration: 228,
    });
    const resolverAlternate = song('qq-yoasobi-english', {
      provider: 'QQ Music',
      title: 'Orion (English Version)',
      artist: 'YOASOBI',
      duration: 224,
    });
    const cleanResolver = song('qq-yoasobi-orion', {
      provider: 'QQ Music',
      title: 'オリオン',
      artist: 'YOASOBI (ヨアソビ)',
      duration: 222,
    });
    const shortResolverAlternate = song('kuwo-yoasobi-interlude', {
      provider: 'Kuwo',
      title: 'Interlude "Worship"',
      artist: 'YOASOBI',
      duration: 83,
    });

    expect(
      rankSearchSongsForAccess(
        [archive, shortResolverAlternate, resolverAlternate, cleanResolver],
        'YOASOBI',
        'full',
      ).map(({ id }) => id),
    ).toEqual(['qq-yoasobi-orion', 'qq-yoasobi-english', 'archive-yoasobi-upload', 'kuwo-yoasobi-interlude']);
  });

  it('pushes live and cover markers below a clean Japanese resolver result', () => {
    const live = song('kuwo-live', {
      provider: 'Kuwo',
      title: '怪物 (2026 ライブ 現場版)',
      artist: 'YOASOBI',
      duration: 229,
    });
    const studio = song('kuwo-studio', {
      provider: 'Kuwo',
      title: '怪物',
      artist: 'YOASOBI',
      duration: 229,
    });

    expect(rankSearchSongsForAccess([live, studio], '怪物', 'full').map(({ id }) => id)).toEqual([
      'kuwo-studio',
      'kuwo-live',
    ]);
  });

  it('keeps official Japanese identities above noisy resolver alternates in All audio', () => {
    const officialTracks = [
      song('itunes-yoru-ni-kakeru', {
        provider: 'Apple Preview',
        title: '\u591c\u306b\u99c6\u3051\u308b',
        artist: 'YOASOBI',
        duration: 30,
      }),
      song('itunes-gunjou', {
        provider: 'Apple Preview',
        title: '\u7fa4\u9752',
        artist: 'YOASOBI',
        duration: 30,
      }),
      song('itunes-idol', {
        provider: 'Apple Preview',
        title: '\u30a2\u30a4\u30c9\u30eb',
        artist: 'YOASOBI',
        duration: 30,
      }),
    ];
    const noisyAlternates = [
      song('archive-sanshoku', {
        provider: 'Archive',
        title: '\u4e09\u539f\u8272',
        artist: 'Yoasobi',
        duration: 228,
      }),
      song('kuwo-translated', {
        provider: 'Kuwo',
        title: '\u6d77\u306e\u307e\u306b\u307e\u306b (\u4efb\u7531\u6d77\u6ce2\u8361\u6f3e)',
        artist: 'YOASOBI',
        duration: 226,
      }),
      song('kuwo-interlude', {
        provider: 'Kuwo',
        title: 'Interlude "Worship"',
        artist: 'YOASOBI',
        duration: 83,
      }),
      song('kuwo-festival-live', {
        provider: 'Kuwo',
        title: '\u602a\u7269 (2026 Lollapalooza\u97f3\u4e50\u8282\u829d\u52a0\u54e5\u7ad9\u73b0\u573a)',
        artist: 'YOASOBI',
        duration: 229,
      }),
      song('kuwo-uploader-title', {
        provider: 'Kuwo',
        title: 'YOASOBI-\u30a2\u30a4\u30c9\u30eb',
        artist: '\u4e8c\u6b21\u5143\u7a7a\u9593&YOASOBI',
        duration: 216,
      }),
    ];

    const ranked = rankSearchSongsForAccess([...noisyAlternates, ...officialTracks], 'YOASOBI', 'all');
    expect(ranked.slice(0, 3).map(({ id }) => id)).toEqual(['itunes-yoru-ni-kakeru', 'itunes-gunjou', 'itunes-idol']);
    expect(ranked).toEqual(expect.arrayContaining(noisyAlternates));
  });

  it('keeps the higher-confidence provider when sources return the same track identity', () => {
    const upload = song('audius-upload', { title: 'Cruel Summer [ic8j13piAhQ]' });
    const official = song('itunes-official', { provider: 'Apple Preview', duration: 30 });

    expect(rankSearchSongs([upload, official], 'Cruel Summer').map(({ id }) => id)).toEqual(['itunes-official']);
  });

  it('filters access before deduplicating equivalent full tracks and previews', () => {
    const upload = song('audius-upload', { title: 'Cruel Summer [ic8j13piAhQ]' });
    const official = song('itunes-official', { provider: 'Apple Preview', duration: 30 });

    expect(rankSearchSongsForAccess([upload, official], 'Cruel Summer', 'full').map(({ id }) => id)).toEqual([
      'audius-upload',
    ]);
    expect(rankSearchSongsForAccess([upload, official], 'Cruel Summer', 'preview').map(({ id }) => id)).toEqual([
      'itunes-official',
    ]);
  });

  it('prefers the full recording when all-audio results contain the same preview', () => {
    const preview = song('itunes-preview', { provider: 'Apple Preview', duration: 30 });
    const fullRecording = song('audius-full', { provider: 'Audius' });

    expect(rankSearchSongsForAccess([preview, fullRecording], 'Cruel Summer', 'all').map(({ id }) => id)).toEqual([
      'audius-full',
    ]);
  });

  it('presents full-length resolver matches alongside direct full tracks in full mode', () => {
    // Different titles so they don't deduplicate as the same recording.
    const direct = song('audius-direct', { provider: 'Audius', title: 'Direct Song' });
    const resolverMatch = song('kuwo-match', { provider: 'Kuwo', duration: 241, title: 'Resolver Song' });

    // Both are now included in 'full' mode: the Kuwo track has a full-track
    // duration (241s >= 45s minimum) and the playback system handles resolver
    // resolution with fallbacks. Hiding it from searches showed users only
    // covers instead of the real track.
    const fullResults = rankSearchSongsForAccess([resolverMatch, direct], 'Resolver Song', 'full').map(({ id }) => id);
    expect(fullResults).toContain('audius-direct');
    expect(fullResults).toContain('kuwo-match');
    expect(rankSearchSongsForAccess([resolverMatch, direct], 'Resolver Song', 'preview')).toEqual([]);
    const allResults = rankSearchSongsForAccess([resolverMatch, direct], 'Resolver Song', 'all').map(({ id }) => id);
    expect(allResults).toContain('audius-direct');
    expect(allResults).toContain('kuwo-match');
  });

  it('does not present obvious short Audius clips as search results', () => {
    const ringtone = song('audius-ringtone', {
      title: 'YOASOBI - Yoru ni Kakeru (iPhone ringtone version)',
      artist: 'lasuah8',
      duration: 35,
    });
    const fullTrack = song('kuwo-full', {
      title: '夜に駆ける',
      artist: 'YOASOBI',
      provider: 'Kuwo',
      duration: 261,
    });

    expect(rankSearchSongsForAccess([ringtone, fullTrack], 'YOASOBI', 'full').map(({ id }) => id)).toEqual([
      'kuwo-full',
    ]);
    expect(rankSearchSongsForAccess([ringtone, fullTrack], 'YOASOBI', 'all').map(({ id }) => id)).toEqual([
      'kuwo-full',
    ]);
  });

  it('keeps every ranked track while separating a compact top-results shelf', () => {
    const songs = Array.from({ length: 8 }, (_, index) => song(`track-${index}`, { title: `Track ${index}` }));

    expect(splitTopSearchMatches(songs, 3)).toEqual({
      topMatches: songs.slice(0, 3),
      remainingTracks: songs.slice(3),
    });
  });

  it('puts a deep official preview lane above open uploads in the compact shelf', () => {
    const archive = song('archive-upload', { provider: 'Archive', title: '\u4e09\u539f\u8272', artist: 'Yoasobi' });
    const official = ['\u591c\u306b\u99c6\u3051\u308b', '\u7fa4\u9752', '\u30a2\u30a4\u30c9\u30eb'].map(
      (title, index) =>
        song(`itunes-official-${index}`, { provider: 'Apple Preview', title, artist: 'YOASOBI', duration: 30 }),
    );

    expect(splitTopSearchMatches([archive, ...official], 3).topMatches).toEqual(official);
    expect(splitTopSearchMatches([archive, ...official], 3).remainingTracks).toEqual([archive]);
  });

  it('deduplicates provider artist records and keeps the strongest exact match', () => {
    const artists = [
      artist('jamendo-artist-1', 'Taylor Swift'),
      artist('itunes-artist-2', 'Taylor Swift'),
      artist('audius-artist-3', 'Taylor Swift fan edits'),
    ];

    expect(rankSearchArtists(artists, 'Taylor Swift').map(({ id }) => id)).toEqual([
      'itunes-artist-2',
      'audius-artist-3',
    ]);
  });

  it('collapses duplicate album records without merging different releases', () => {
    const albums = [
      album('jamendo-album-1', 'Lover', 'Taylor Swift'),
      album('itunes-album-2', 'Lover', 'Taylor Swift'),
      album('itunes-album-3', '1989', 'Taylor Swift'),
    ];

    expect(rankSearchAlbums(albums, 'Taylor Swift').map(({ id }) => id)).toEqual(['itunes-album-2', 'itunes-album-3']);
  });

  it('summarizes result, empty, partial, and unavailable search sources', () => {
    const summaries = summarizeSearchProviders(
      ['Audius', 'Jamendo', 'ccMixter', 'Archive'],
      [song('audius-result')],
      ['Archive'],
      ['ccMixter'],
    );

    expect(summaries).toEqual([
      { name: 'Audius', resultCount: 1, status: 'results' },
      { name: 'Jamendo', resultCount: 0, status: 'no-match' },
      { name: 'ccMixter', resultCount: 0, status: 'partial' },
      { name: 'Archive', resultCount: 0, status: 'unavailable' },
    ]);
  });

  it('counts degraded providers when every search source is unavailable', () => {
    expect(
      areAllSearchProvidersUnavailable({
        results: [],
        failedProviders: ['Audius'],
        degradedProviders: ['ccMixter'],
        providerCount: 2,
      }),
    ).toBe(true);
    expect(
      areAllSearchProvidersUnavailable({
        results: [song('healthy-result')],
        failedProviders: ['Audius'],
        degradedProviders: ['ccMixter'],
        providerCount: 2,
      }),
    ).toBe(false);
  });
});
