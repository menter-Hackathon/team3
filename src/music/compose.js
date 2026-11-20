// 【出力（原曲の選択・MIDI の編集・曲の長さ＝うごてん、楽譜＝たいが）】設計図 → 楽譜（Score）。ここではまだ音を鳴らさない。
// 受け渡しの形は docs/interfaces.md の「5. 設計図」「6. 原曲」「7. 楽譜」。原曲の MIDI を読むので async。
//
// compose(blueprint, { loadMidi }?) → Promise<Score>
//   1. 原曲を読む        設計図の baseSong（1〜4）→ public/songs/song{baseSong}.mid
//   2. 曲の長さを決める   tempoPlan（叩いた速さ・テンポの変化）→ planLayout で約1分になる小節の数（src/music/edit/layout.js）
//   3. 頭から必要な小節だけにする（trimToBars）
//   4. 設計図で MIDI を編集する（editMidiByBlueprint。移調・音階・音域・音の柔らかさ・ドラム・音の多さ・1問ごとの区間・テンポ・ノリ）
//   5. 楽譜にする（midiToScore。曲の構成は 2 の小節の数、最後のアウトロで音楽だけフェードアウト）
//   loadMidi(baseSong) → Promise<Midi>  原曲の読み方を差し替える（Node での確認用）。省くとブラウザで fetch する
//   同じ設計図からは同じ曲になる（揺らぎは設計図から作った種の乱数）
import { NOTES, normalizeBlueprint } from "../blueprint.js";
const NOTE_INDEX = Object.fromEntries(NOTES.map((n, i) => [n, i]));
import { editMidiByBlueprint, tempoPlan } from "./edit/blueprintEdit.js";
import { planLayout, trimToBars } from "./edit/layout.js";
import { midiToScore } from "./midiToScore.js";

export async function compose(blueprint, { loadMidi = fetchSong } = {}) {
  const bp = normalizeBlueprint(blueprint);
  const source = await loadMidi(bp.baseSong);
  const { midi, layout } = fitLength(source, bp);
  const { midi: edited } = editMidiByBlueprint(midi, bp, null, { layout });
  const score = midiToScore(edited, bp, layout).score;
  score.tracks.blink = blinkTrack(score, bp.blinks);
  return score;
}

// 瞬き → その問の区間の同じ位置に鳴らす小さな鐘。音の高さは、曲で一番よく使われている音（主音に近い）の高い所
const BLINK_OCTAVE = 6;
const BLINK_VELOCITY = 0.5;
export function blinkTrack(score, blinks = []) {
  if (!blinks.length) return [];
  const count = new Array(12).fill(0);
  for (const e of score.tracks.pad ?? []) for (const n of e.notes) count[NOTE_INDEX[n.replace(/-?\d+$/, "")] ?? 0] += 1;
  for (const e of score.tracks.melody ?? []) count[NOTE_INDEX[e.note.replace(/-?\d+$/, "")] ?? 0] += 1;
  const note = `${NOTES[count.indexOf(Math.max(...count))]}${BLINK_OCTAVE}`;
  const times = [];
  for (const b of blinks) {
    const sec = score.structure.find((s) => s.name === `q${b.q}`);
    if (!sec) continue;
    let ms = Math.round((sec.start + b.at * (sec.end - sec.start)) * 1000); // ミリ秒の整数で比べる（丸めて同じ時刻にならないように）
    while (times.includes(ms)) ms += 1; // 同じトラックで同じ time を使わない決まり
    if (ms >= 0 && ms < score.duration * 1000) times.push(ms);
  }
  return times.sort((a, b) => a - b).map((ms) => ({ time: ms / 1000, note, velocity: BLINK_VELOCITY }));
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
