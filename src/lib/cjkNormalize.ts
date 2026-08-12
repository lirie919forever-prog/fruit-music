/**
 * CJK normalization for cross-provider music matching.
 *
 * Japanese Apple chart tracks use kanji (traditional), katakana, and hiragana.
 * Chinese music platforms (Kugou, QQ, Netease, Kuwo) use simplified Chinese and
 * may use hiragana where Apple uses katakana. Without normalizing these
 * differences, the track resolver rejects valid full-track matches.
 *
 * Three fixes:
 *  1. NFKC recombination: NFKD decomposes Japanese dakuten (e.g. ド → ト + combining
 *     mark); the non-letter regex replaces the orphaned mark with a space,
 *     corrupting the text. NFKC after stripping recombines the marks.
 *  2. Katakana → Hiragana: codepoint subtraction (U+30A0–U+30FF → U+3040–U+309F).
 *  3. Traditional → Simplified: lookup table for ~110 common Japanese kanji
 *     that differ from mainland Chinese simplified forms.
 */

const TRAD_TO_SIMP: Record<string, string> = {"樂":"乐","師":"师","廣":"广","慶":"庆","萬":"万","義":"义","亞":"亚","產":"产","僅":"仅","從":"从","眾":"众","內":"内","軍":"军","創":"创","擊":"击","動":"动","勞":"劳","醫":"医","華":"华","協":"协","賣":"卖","衛":"卫","變":"变","帶":"带","開":"开","異":"异","張":"张","當":"当","錄":"录","憂":"忧","戶":"户","掃":"扫","揮":"挥","損":"损","換":"换","數":"数","於":"于","時":"时","會":"会","歸":"归","氣":"气","決":"决","無":"无","爲":"为","畫":"画","話":"话","語":"语","說":"说","蹤":"踪","車":"车","軟":"软","轉":"转","連":"连","進":"进","運":"运","過":"过","遠":"远","選":"选","還":"还","邊":"边","際":"际","離":"离","電":"电","風":"风","體":"体","魚":"鱼","鳥":"鸟","鳴":"鸣","龍":"龙","鐵":"铁","長":"长","關":"关","陣":"阵","陽":"阳","題":"题","點":"点","號":"号","區":"区","國":"国","學":"学","聲":"声","經":"经","應":"应","寶":"宝","給":"给","結":"结","繼":"继","紀":"纪","濟":"济","計":"计","戲":"剧","覺":"觉","麗":"丽","廟":"庙","廠":"厂","組":"组","隊":"队","單":"单","對":"对","觀":"观","顯":"显","淨":"净","潔":"洁","沒":"没","絕":"纠","錢":"钱","霧":"雾","綱":"缄","網":"网","魔":"魍"};

/**
 * Normalize CJK text for fuzzy cross-provider matching.
 * Apply NFKC recombination, katakana→hiragana, and traditional→simplified.
 * Call this AFTER NFKD + Latin diacritics stripping in normalizePlaybackText.
 */
// Japanese shinjitai (standard JP kanji) forms that diverge from PRC
// simplified. Apple Japan chart titles use these, while Kugou/Netease/QQ
// use the PRC simplified form, so e.g. JP U+697d must match PRC U+4e50.
// Built from codepoints so this file stays pure-ASCII and round-trips.
const SHINJITAI_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [0x697d, 0x4e50],
  [0x6c17, 0x6c14],
  [0x56e3, 0x56e2],
  [0x5e83, 0x5e7f],
  [0x5909, 0x53d8],
  [0x82b8, 0x827a],
  [0x5fdc, 0x5e94],
  [0x96d1, 0x6742],
  [0x7d4c, 0x7ecf],
  [0x6ca2, 0x6cfd],
  [0x4f1d, 0x4f20],
  [0x7d9a, 0x7eed],
];
export const SHINJITAI_TO_SIMP: Record<string, string> = Object.fromEntries(
  SHINJITAI_PAIRS.map(([t, s]) => [String.fromCodePoint(t), String.fromCodePoint(s)] as [string, string]),
);
const KANJI_SIMPLIFY: Record<string, string> = { ...TRAD_TO_SIMP, ...SHINJITAI_TO_SIMP };

export function normalizeCJK(text: string): string {
  let result = text;

  // 1. NFKC recombines Japanese dakuten that NFKD decomposed (e.g. ト+゙ → ド)
  result = result.normalize('NFKC');

  // 2. Convert katakana to hiragana (U+30A0–U+30FF → hiragana range)
  result = result.replace(/[\u30A0-\u30FF]/g, (ch) => {
    const cp = ch.codePointAt(0)!;
    const hiragana = cp - 0x60;
    if (hiragana >= 0x3040 && hiragana <= 0x309F) return String.fromCodePoint(hiragana);
    return ch;
  });

  // 3. Convert traditional Chinese characters to simplified
  result = result.replace(/[\u4e00-\u9fff]/g, (ch) => KANJI_SIMPLIFY[ch] ?? ch);

  return result;
}

export { TRAD_TO_SIMP };
