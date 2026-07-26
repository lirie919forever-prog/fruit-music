import { describe, expect, it } from 'vitest';
import { activeLyricIndex, isUsableSync, parseLrc, syncFitsTrack, type LyricLine } from './lrc';

describe('parseLrc', () => {
  it('reads minutes, seconds and centiseconds as one position', () => {
    expect(parseLrc('[01:23.45] line')).toEqual([{ time: 83.45, text: 'line' }]);
  });

  it('scales the fraction by its digit count, not by a fixed thousand', () => {
    // The three forms of the same instant. Dividing every fraction by 1000
    // would place the two-digit form — the one almost every file uses — at
    // 12.05s instead of 12.5s.
    expect(parseLrc('[00:12.5] a')[0].time).toBeCloseTo(12.5, 5);
    expect(parseLrc('[00:12.50] a')[0].time).toBeCloseTo(12.5, 5);
    expect(parseLrc('[00:12.500] a')[0].time).toBeCloseTo(12.5, 5);
  });

  it('accepts a colon before the fraction, which some tools emit', () => {
    expect(parseLrc('[00:12:50] a')[0].time).toBeCloseTo(12.5, 5);
  });

  it('accepts a timestamp with no fraction at all', () => {
    expect(parseLrc('[02:07] line')).toEqual([{ time: 127, text: 'line' }]);
  });

  it('expands a line carrying several timestamps into one entry each', () => {
    expect(parseLrc('[00:10.00][01:20.00][02:30.00] chorus')).toEqual([
      { time: 10, text: 'chorus' },
      { time: 80, text: 'chorus' },
      { time: 150, text: 'chorus' },
    ]);
  });

  it('returns lines in time order even when the file is not', () => {
    const parsed = parseLrc('[00:30.00] third\n[00:10.00] first\n[00:20.00] second');
    expect(parsed.map((line) => line.text)).toEqual(['first', 'second', 'third']);
  });

  it('drops metadata tags without treating them as lines', () => {
    const parsed = parseLrc('[ar:Radiohead]\n[ti:Creep]\n[by:someone]\n[00:19.16] When you were here before');
    expect(parsed).toEqual([{ time: 19.16, text: 'When you were here before' }]);
  });

  it('shifts every line earlier by a positive offset tag', () => {
    const parsed = parseLrc('[offset:+500]\n[00:10.00] a\n[00:20.00] b');
    expect(parsed.map((line) => line.time)).toEqual([9.5, 19.5]);
  });

  it('shifts every line later by a negative offset tag', () => {
    expect(parseLrc('[offset:-500]\n[00:10.00] a')[0].time).toBeCloseTo(10.5, 5);
  });

  it('never lets an offset push a line before zero', () => {
    expect(parseLrc('[offset:+5000]\n[00:01.00] a')[0].time).toBe(0);
  });

  it('ignores an offset tag that is not a number', () => {
    expect(parseLrc('[offset:soon]\n[00:10.00] a')[0].time).toBe(10);
  });

  it('strips enhanced-LRC word timings from the text', () => {
    expect(parseLrc('[00:10.00] <00:10.00>Hello <00:10.50>world')).toEqual([{ time: 10, text: 'Hello world' }]);
  });

  it('keeps brackets that appear after the timestamps as lyric text', () => {
    // Backing vocals are written this way constantly. Treating the first
    // bracket after a timestamp as metadata would eat half the line.
    expect(parseLrc('[00:10.00] I said [oh oh oh]')).toEqual([{ time: 10, text: 'I said [oh oh oh]' }]);
  });

  it('keeps a timestamped blank line, which is how a gap is written', () => {
    const parsed = parseLrc('[00:10.00] a\n[00:14.00]\n[00:30.00] b');
    expect(parsed).toEqual([
      { time: 10, text: 'a' },
      { time: 14, text: '' },
      { time: 30, text: 'b' },
    ]);
  });

  it('drops untimed text rather than guessing where it belongs', () => {
    expect(parseLrc('a plain line\n[00:10.00] timed')).toEqual([{ time: 10, text: 'timed' }]);
  });

  it('rejects a malformed timestamp instead of misreading it', () => {
    // 71 seconds is not a valid seconds field, and `[00:1x.00]` is not a
    // timestamp at all. Both lines are untimed and so are dropped.
    expect(parseLrc('[00:71.00] a\n[00:1x.00] b')).toEqual([]);
  });

  it('handles minutes past ninety-nine', () => {
    expect(parseLrc('[123:45.00] long set')).toEqual([{ time: 7425, text: 'long set' }]);
  });

  it('reads a CRLF document', () => {
    expect(parseLrc('[00:10.00] a\r\n[00:20.00] b')).toHaveLength(2);
  });

  it('returns nothing for empty, blank or non-string input', () => {
    expect(parseLrc('')).toEqual([]);
    expect(parseLrc('   \n  ')).toEqual([]);
    expect(parseLrc(null as unknown as string)).toEqual([]);
  });
});

describe('activeLyricIndex', () => {
  const lines: LyricLine[] = [
    { time: 10, text: 'a' },
    { time: 20, text: 'b' },
    { time: 30, text: 'c' },
  ];

  it('reports no line before the first timestamp', () => {
    expect(activeLyricIndex(lines, 0)).toBe(-1);
    expect(activeLyricIndex(lines, 9.99)).toBe(-1);
  });

  it('holds a line until the next one starts', () => {
    expect(activeLyricIndex(lines, 10)).toBe(0);
    expect(activeLyricIndex(lines, 19.99)).toBe(0);
    expect(activeLyricIndex(lines, 20)).toBe(1);
  });

  it('holds the last line past the end of the document', () => {
    expect(activeLyricIndex(lines, 9_999)).toBe(2);
  });

  it('handles an empty document and a non-finite time', () => {
    expect(activeLyricIndex([], 5)).toBe(-1);
    expect(activeLyricIndex(lines, Number.NaN)).toBe(-1);
  });

  it('agrees with a linear scan across a long document', () => {
    const long = Array.from({ length: 500 }, (_, index) => ({ time: index * 2, text: `line ${index}` }));
    for (const time of [0, 1, 3.5, 101, 500.5, 998, 1_500]) {
      const scanned = long.reduce((found, line, index) => (line.time <= time ? index : found), -1);
      expect(activeLyricIndex(long, time)).toBe(scanned);
    }
  });
});

describe('isUsableSync', () => {
  it('rejects a document with everything pinned to zero', () => {
    expect(
      isUsableSync([
        { time: 0, text: 'a' },
        { time: 0, text: 'b' },
      ]),
    ).toBe(false);
  });

  it('rejects a single line and an empty document', () => {
    expect(isUsableSync([{ time: 10, text: 'a' }])).toBe(false);
    expect(isUsableSync([])).toBe(false);
  });

  it('accepts a document that actually advances', () => {
    expect(
      isUsableSync([
        { time: 0, text: 'a' },
        { time: 10, text: 'b' },
      ]),
    ).toBe(true);
  });
});

describe('syncFitsTrack', () => {
  const fullRecording: LyricLine[] = [
    { time: 19, text: 'first' },
    { time: 200, text: 'last' },
  ];

  it('refuses a document that outruns a thirty-second preview', () => {
    // The whole reason this exists. Apple's charts play a clip from the middle
    // of the recording, and its lyrics are timed from the recording's start —
    // so following them highlights the wrong line for the entire clip.
    expect(syncFitsTrack(fullRecording, 30)).toBe(false);
  });

  it('accepts a document that ends inside the track', () => {
    expect(syncFitsTrack(fullRecording, 240)).toBe(true);
  });

  it('allows a last line timed a moment past the end', () => {
    // Fades and outro tags routinely put the closing line right on the buzzer.
    expect(
      syncFitsTrack(
        [
          { time: 0, text: 'a' },
          { time: 183, text: 'b' },
        ],
        180,
      ),
    ).toBe(true);
    expect(
      syncFitsTrack(
        [
          { time: 0, text: 'a' },
          { time: 200, text: 'b' },
        ],
        180,
      ),
    ).toBe(false);
  });

  it('refuses when there is no document or no known duration', () => {
    expect(syncFitsTrack([], 200)).toBe(false);
    expect(syncFitsTrack(fullRecording, 0)).toBe(false);
    expect(syncFitsTrack(fullRecording, Number.NaN)).toBe(false);
  });
});
