import { describe, expect, it } from 'vitest';
import {
  isLrclibRecord,
  normalizeArtist,
  normalizeTitle,
  pickLyricsMatch,
  scoreRecord,
  toLyricsResult,
  type LrclibRecord,
} from './lrclib';

const SYNCED = '[00:10.00] first line\n[00:20.00] second line';

function record(overrides: Partial<LrclibRecord> = {}): LrclibRecord {
  return {
    id: 1,
    trackName: 'Blinding Lights',
    artistName: 'The Weeknd',
    albumName: 'After Hours',
    duration: 200,
    instrumental: false,
    plainLyrics: 'first line\nsecond line',
    syncedLyrics: SYNCED,
    ...overrides,
  };
}

const QUERY = { track: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', duration: 200 };

describe('normalizeTitle', () => {
  it('drops a parenthetical qualifier', () => {
    expect(normalizeTitle('Song (Remastered 2015)')).toBe('song');
    expect(normalizeTitle('Song [Live]')).toBe('song');
  });

  it('drops a dash-suffixed qualifier', () => {
    expect(normalizeTitle('Song - Radio Edit')).toBe('song');
  });

  it('drops featured artists', () => {
    expect(normalizeTitle('Song feat. Someone')).toBe('song');
    expect(normalizeTitle('Song ft Someone')).toBe('song');
  });

  it('folds punctuation, case and accents together', () => {
    expect(normalizeTitle("Don't Stop Me Now")).toBe(normalizeTitle('Dont Stop Me Now'));
    expect(normalizeTitle('Café')).toBe(normalizeTitle('Cafe'));
  });

  it('keeps a hyphenated word that is part of the title', () => {
    // The dash rule needs surrounding space, or "Re-Wired" loses half of itself.
    expect(normalizeTitle('Re-Wired')).toBe('re wired');
  });
});

describe('normalizeArtist', () => {
  it('takes the lead artist from every way a collaboration is written', () => {
    for (const written of ['A & B', 'A / B', 'A, B', 'A feat. B', 'A x B', 'A × B']) {
      expect(normalizeArtist(written)).toBe('a');
    }
  });
});

describe('scoreRecord', () => {
  it('rejects a different song with the same artist', () => {
    expect(scoreRecord(record({ trackName: 'Save Your Tears' }), QUERY)).toBeNull();
  });

  it('rejects the same title by a different artist', () => {
    expect(scoreRecord(record({ artistName: 'Someone Else' }), QUERY)).toBeNull();
  });

  it('accepts a partially billed artist name', () => {
    expect(scoreRecord(record({ artistName: 'Weeknd' }), QUERY)).not.toBeNull();
  });

  it('rejects a record carrying no lyrics at all', () => {
    expect(scoreRecord(record({ syncedLyrics: null, plainLyrics: '', instrumental: false }), QUERY)).toBeNull();
  });

  it('accepts an instrumental record with no lyrics', () => {
    expect(scoreRecord(record({ syncedLyrics: null, plainLyrics: null, instrumental: true }), QUERY)).not.toBeNull();
  });

  it('ranks a synced record above a plain-text one', () => {
    const synced = scoreRecord(record(), QUERY)!;
    const plain = scoreRecord(record({ syncedLyrics: null }), QUERY)!;
    expect(synced).toBeGreaterThan(plain);
  });

  it('rejects a record whose duration is far from a trusted one', () => {
    expect(scoreRecord(record({ duration: 400 }), QUERY)).toBeNull();
  });

  it('ignores duration entirely for a preview-length query', () => {
    // Apple's catalog reports thirty seconds because that is all a preview is.
    // Comparing it against a two-hundred-second recording must not reject the
    // only correct answer, which is what a naive duration filter does.
    const preview = { ...QUERY, duration: 30 };
    expect(scoreRecord(record({ duration: 200 }), preview)).not.toBeNull();
    expect(scoreRecord(record({ duration: 400 }), preview)).not.toBeNull();
  });

  it('prefers the closer duration when the query duration is trusted', () => {
    const near = scoreRecord(record({ duration: 201 }), QUERY)!;
    const far = scoreRecord(record({ duration: 209 }), QUERY)!;
    expect(near).toBeGreaterThan(far);
  });

  it('prefers a matching album', () => {
    const matching = scoreRecord(record(), QUERY)!;
    const compilation = scoreRecord(record({ albumName: "Now That's What I Call 40" }), QUERY)!;
    expect(matching).toBeGreaterThan(compilation);
  });

  it('prefers the title that needed no trimming', () => {
    const exact = scoreRecord(record(), QUERY)!;
    const live = scoreRecord(record({ trackName: 'Blinding Lights (Live)' }), QUERY)!;
    expect(exact).toBeGreaterThan(live);
  });
});

describe('pickLyricsMatch', () => {
  it('picks the synced record over an earlier plain-text one', () => {
    const chosen = pickLyricsMatch([record({ id: 1, syncedLyrics: null }), record({ id: 2 })], {
      track: 'Blinding Lights',
      artist: 'The Weeknd',
    });
    expect(chosen?.id).toBe(2);
  });

  it('breaks a tie towards the older record', () => {
    const chosen = pickLyricsMatch([record({ id: 900 }), record({ id: 12 })], QUERY);
    expect(chosen?.id).toBe(12);
  });

  it('returns null when nothing in the list is the song', () => {
    expect(pickLyricsMatch([record({ trackName: 'Something Else' })], QUERY)).toBeNull();
  });

  it('skips malformed entries instead of throwing on them', () => {
    const chosen = pickLyricsMatch([null, 'nope', { id: 'x' }, {}, record({ id: 7 })], QUERY);
    expect(chosen?.id).toBe(7);
  });

  it('returns null for anything that is not a list', () => {
    expect(pickLyricsMatch({ results: [] }, QUERY)).toBeNull();
    expect(pickLyricsMatch(null, QUERY)).toBeNull();
  });
});

describe('isLrclibRecord', () => {
  it('accepts a record with only plain lyrics', () => {
    expect(isLrclibRecord({ id: 1, trackName: 'a', artistName: 'b', plainLyrics: 'x' })).toBe(true);
  });

  it('rejects a record with no lyrics and no instrumental flag', () => {
    expect(isLrclibRecord({ id: 1, trackName: 'a', artistName: 'b' })).toBe(false);
  });

  it('rejects a numeric id sent as a string', () => {
    expect(isLrclibRecord({ id: '1', trackName: 'a', artistName: 'b', plainLyrics: 'x' })).toBe(false);
  });
});

describe('toLyricsResult', () => {
  it('parses the synced document and links to the record it came from', () => {
    const result = toLyricsResult(record({ id: 496 }));
    expect(result.sourceUrl).toBe('https://lrclib.net/api/get/496');
    expect(result.synced).toEqual([
      { time: 10, text: 'first line' },
      { time: 20, text: 'second line' },
    ]);
    expect(result.plain).toBe('first line\nsecond line');
  });

  it('reports no sync for a document that never advances', () => {
    const result = toLyricsResult(record({ syncedLyrics: '[00:00.00] a\n[00:00.00] b' }));
    expect(result.synced).toEqual([]);
    expect(result.plain).not.toBe('');
  });

  it('carries the instrumental flag through with empty text', () => {
    const result = toLyricsResult(record({ instrumental: true, syncedLyrics: null, plainLyrics: null }));
    expect(result).toMatchObject({ instrumental: true, synced: [], plain: '' });
  });
});
