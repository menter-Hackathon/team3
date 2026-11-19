// 【出力・共通】MIDI のトラックの見分け。MIDI の編集（うごてん）と MIDI → 楽譜（たいが）の両方が使う。
// 変えるとどちらにも効くので、変えるときは2人で相談する。原曲のトラック名の決まりは docs/interfaces.md の「6. 原曲」。
// ここでは音を鳴らさない・ブラウザの機能を使わない（Node でも動く）。
//
// isDrum(track)    → ドラムのトラックか（チャンネル10 か、名前に drum / perc を含む）
// findParts(midi)  → { pitched, melody, pad, drums }
//   pitched  ドラム以外で音のあるトラック
//   melody   名前に melody / lead / vocal。なければ和音でないトラックのうち平均の音が一番高いもの（なければ null）
//   pad      名前に pad / chord / string（なければ null）。メロディとパッドが同じトラックになるときはメロディなし
//   drums    ドラムのトラック

export function isDrum(track) {
  return track.instrument.percussion || track.channel === 9 || /drum|perc/i.test(track.name);
}

export function findParts(midi) {
  const tracks = midi.tracks.filter((t) => t.notes.length);
  const pitched = tracks.filter((t) => !isDrum(t));
  const byName = (re) => pitched.find((t) => re.test(t.name)) ?? null;
  const pad = byName(/pad|chord|string/i);
  const melody = byName(/melody|lead|vocal/i) ?? maxBy(pitched.filter((t) => t !== pad && !isChordal(t)), avgPitch);
  return { pitched, melody: melody === pad ? null : melody, pad, drums: tracks.filter(isDrum) };
}

// 同じ時刻に2つ以上の音がある割合が 3 割を超えるトラックは和音のトラック
export function isChordal(track) {
  const count = new Map();
  for (const n of track.notes) count.set(n.ticks, (count.get(n.ticks) ?? 0) + 1);
  const stacked = track.notes.filter((n) => count.get(n.ticks) > 1).length;
  return stacked / track.notes.length > 0.3;
}

// トラックの平均の音の高さ（MIDI の番号）
export function avgPitch(track) {
  return track.notes.reduce((a, n) => a + n.midi, 0) / track.notes.length;
}

const maxBy = (list, score) => list.reduce((best, x) => (best === null || score(x) > score(best) ? x : best), null);
