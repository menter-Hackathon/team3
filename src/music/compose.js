// 【出力（原曲の選択・MIDI の編集・曲の長さ＝うごてん、楽譜＝たいが）】設計図 → 楽譜（Score）。ここではまだ音を鳴らさない。
// 受け渡しの形は docs/interfaces.md の「5. 設計図」「6. 原曲」「7. 楽譜」。原曲の MIDI を読むので async。
//
// compose(blueprint, { loadMidi }?) → Promise<Score>
//   1. 原曲を読む        設計図の baseSong（1〜4）→ public/songs/song{baseSong}.mid
//   2. 曲の長さを決める   tempoPlan（叩いた速さ・テンポの変化）→ planLayout で約1分になる小節の数（src/music/edit/layout.js）
//   3. 頭から必要な小節だけにする（trimToBars）
//   4. 設計図で MIDI を編集する（editMidiByBlueprint。移調・音域・音の柔らかさ・ドラム・テンポ・ノリ）
//   5. 楽譜にする（midiToScore。曲の構成は 2 の小節の数、最後のアウトロで音楽だけフェードアウト）
//   loadMidi(baseSong) → Promise<Midi>  原曲の読み方を差し替える（Node での確認用）。省くとブラウザで fetch する
//   同じ設計図からは同じ曲になる（揺らぎは設計図から作った種の乱数）
// 原曲を選ぶ（質問の答え → baseSong）・scale・density・sections は、まだ使っていない（次の段階）
import { normalizeBlueprint } from "../blueprint.js";
import { editMidiByBlueprint, tempoPlan } from "./edit/blueprintEdit.js";
import { planLayout, trimToBars } from "./edit/layout.js";
import { midiToScore } from "./midiToScore.js";

export async function compose(blueprint, { loadMidi = fetchSong } = {}) {
  const bp = normalizeBlueprint(blueprint);
  const source = await loadMidi(bp.baseSong);
  const { midi, layout } = fitLength(source, bp);
  const { midi: edited } = editMidiByBlueprint(midi, bp, null, { bars: layout.totalBars });
  return midiToScore(edited, bp, layout).score;
}

// 原曲 → 約1分の長さにした原曲と、その小節の数（dev ページも同じ順で使う）
export function fitLength(source, blueprint) {
  const { bpm, drift } = tempoPlan(blueprint, source);
  const barTicks = source.header.ppq * 4;
  const endTick = Math.max(0, ...source.tracks.flatMap((t) => t.notes.map((n) => n.ticks + n.durationTicks)));
  const layout = planLayout(bpm, drift, Math.ceil(endTick / barTicks));
  return { midi: trimToBars(source, layout.totalBars), layout };
}

async function fetchSong(baseSong) {
  const res = await fetch(`/songs/song${baseSong}.mid`);
  if (!res.ok) throw new Error(`原曲 song${baseSong}.mid を読めませんでした（${res.status}）`);
  // ブラウザで読むときだけ読み込む（@tonejs/midi は CommonJS なので、Node では名前付きで import できないため）
  const mod = await import("@tonejs/midi");
  const Midi = mod.Midi ?? mod.default.Midi;
  return new Midi(await res.arrayBuffer());
}
