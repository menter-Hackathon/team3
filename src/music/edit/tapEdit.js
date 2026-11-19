// 【叩いたリズムの担当】叩く間隔 → 原曲の MIDI を編集する（ドラムの細かさ → テンポ・テンポの変化 → ノリ・揺らぎ）。
// ここでは音を鳴らさない・ブラウザの機能を使わない（Node でも動く）。
// 編集の順番は「声の編集（移調・音域）のあと」。こちらは時間だけを変えるので、音の高さの編集とはぶつからない。
//
// 流れ:
//   叩く間隔（ミリ秒の配列）─ tapToParams() ─→ params ─ editMidiByTaps(midi, params) ─→ 編集した MIDI
//
// tapToParams(intervalsMs) → params
//   intervalsMs   入力チームからもらう「叩いた間隔」の配列（ミリ秒。例: [650, 640, 660, …]）
//   bpm           叩いた速さ（60〜160）。取れなければ null（原曲のテンポのまま）
//   groove        4拍それぞれのズレ（秒、各 ±0.05）。取れなければ [0, 0, 0, 0]
//   stability     叩くたびのバラつきの小ささ（0〜1）。取れなければ null
//   tempoEndFactor 曲の最後のテンポ ÷ 最初のテンポ（0.9〜1.1）。だんだん速く叩いた人は 1 より大きい
//   hatDivision   ハイハットの細かさ（4 = 4分音符、8 = 8分音符、16 = 16分音符）。取れなければ null（原曲のまま）
//   humanize      揺らぎの大きさ（0〜1）= 1 − stability。取れなければ 0
//
// editMidiByTaps(midi, params) → { midi, report }
//   midi    @tonejs/midi の Midi。元の midi は書き換えず、編集したコピーを返す
//   report  何をしたか（画面表示・確認用）
//   原曲は 4/4 拍子が前提（docs の案）
import { Midi } from "@tonejs/midi";
import { analyzeTaps } from "../../input/tap.js";
import { clamp, median } from "../../util.js";
import { findParts } from "./voiceEdit.js";

// ── 叩く間隔 → 編集の値 ──────────────────────────────

const MIN_INTERVAL_MS = 150; // analyzeTaps と同じ。これより短い・長い間隔は叩き損じとして外す
const MAX_INTERVAL_MS = 2000;
const MIN_DRIFT_INTERVALS = 6; // テンポの変化を見るのに必要な間隔の数
const DRIFT_MIN = 0.9; // テンポの変化は ±10% まで
const DRIFT_MAX = 1.1;
const DRIFT_IGNORE = 0.02; // ±2% 未満の変化は「変化なし」とする
const HUMANIZE_TIME_SEC = 0.02; // 揺らぎ 1 のとき、音の時刻を最大 ±20ms ずらす
const HUMANIZE_VELOCITY = 0.12; // 揺らぎ 1 のとき、音の強さを最大 ±0.12 変える

export function tapToParams(intervalsMs) {
  const intervals = Array.isArray(intervalsMs) ? intervalsMs.filter((ms) => Number.isFinite(ms) && ms > 0) : [];
  const times = [0];
  for (const ms of intervals) times.push(times[times.length - 1] + ms);
  const taps = intervals.length >= 3 ? analyzeTaps(times) : null;
  if (!taps) {
    return { bpm: null, groove: [0, 0, 0, 0], stability: null, tempoEndFactor: 1, hatDivision: null, humanize: 0 };
  }
  return {
    bpm: taps.bpm,
    groove: taps.groove.map((sec) => Math.round(sec * 1000) / 1000), // ミリ秒単位にそろえる
    stability: round(taps.stability),
    tempoEndFactor: tempoDrift(intervals),
    hatDivision: hatDivision(taps.bpm, taps.stability),
    humanize: round(1 - taps.stability),
  };
}

// 前半と後半の間隔の中央値を比べる。後半の間隔が短い（速くなった）なら 1 より大きい
function tempoDrift(intervals) {
  const valid = intervals.filter((ms) => ms > MIN_INTERVAL_MS && ms < MAX_INTERVAL_MS);
  if (valid.length < MIN_DRIFT_INTERVALS) return 1;
  const half = Math.floor(valid.length / 2);
  const ratio = median(valid.slice(0, half)) / median(valid.slice(valid.length - half));
  if (Math.abs(ratio - 1) < DRIFT_IGNORE) return 1;
  return round(clamp(ratio, DRIFT_MIN, DRIFT_MAX));
}

// ゆっくり安定して叩く人は細かく（16分）、バラつきの大きい人は間引く（4分）、それ以外は 8分
function hatDivision(bpm, stability) {
  if (stability < 0.25) return 4;
  if (bpm < 100 && stability >= 0.5) return 16;
  return 8;
}

// ── MIDI の編集 ──────────────────────────────────

const CLOSED_HAT = 42; // General MIDI のクローズド・ハイハット
const BEATS_PER_BAR = 4;

export function editMidiByTaps(source, params, seed = 1) {
  const midi = new Midi(source.toArray()); // 元を書き換えないようにコピー
  const ppq = midi.header.ppq;
  const barTicks = ppq * BEATS_PER_BAR;
  const parts = findParts(midi);
  const endTick = Math.max(0, ...midi.tracks.flatMap((t) => t.notes.map((n) => n.ticks + n.durationTicks)));
  const bars = Math.max(1, Math.ceil(endTick / barTicks));
  const originalBpm = midi.header.tempos[0]?.bpm ?? 120;

  // 1. ドラムの細かさ: ハイハット（42番）を、決めた細かさで刻み直す。原曲にハイハットがなければ何もしない
  let hats = null;
  if (params.hatDivision) {
    for (const track of parts.drums) {
      const old = track.notes.filter((n) => n.midi === CLOSED_HAT);
      if (!old.length) continue;
      const velocity = median(old.map((n) => n.velocity));
      track.notes = track.notes.filter((n) => n.midi !== CLOSED_HAT);
      const step = barTicks / params.hatDivision;
      for (let t = 0; t < bars * barTicks; t += step) {
        const onBeat = t % ppq === 0;
        track.addNote({ midi: CLOSED_HAT, ticks: t, durationTicks: Math.round(step / 2), velocity: onBeat ? velocity : velocity * 0.7 });
      }
      hats = { before: old.length, after: track.notes.filter((n) => n.midi === CLOSED_HAT).length };
    }
  }

  // 2. テンポ・テンポの変化: 1小節ごとにテンポを置き、最初の速さから最後の速さまで少しずつ変える
  const startBpm = params.bpm ?? originalBpm;
  const factor = Number.isFinite(params.tempoEndFactor) ? params.tempoEndFactor : 1;
  const endBpm = startBpm * factor;
  midi.header.tempos = [];
  const tempoBars = factor === 1 ? 1 : bars;
  for (let bar = 0; bar < tempoBars; bar++) {
    const bpm = tempoBars > 1 ? startBpm + ((endBpm - startBpm) * bar) / (tempoBars - 1) : startBpm;
    midi.header.tempos.push({ bpm: round(bpm), ticks: bar * barTicks });
  }
  midi.header.update();
  const bpmAt = (ticks) => midi.header.tempos[Math.min(tempoBars - 1, Math.floor(ticks / barTicks))].bpm;
  const secToTicks = (sec, ticks) => (sec * bpmAt(ticks) * ppq) / 60;

  // 3. ノリと揺らぎ: 拍の中の位置に合わせて groove のズレを足し、揺らぎの分だけ時刻と強さを少し揺らす
  //    拍と拍の間の音は、前後の拍のズレを直線でつないだ値にする
  const groove = Array.isArray(params.groove) && params.groove.length === 4 ? params.groove : [0, 0, 0, 0];
  const amount = clamp(Number.isFinite(params.humanize) ? params.humanize : 0, 0, 1);
  const random = seededRandom(seed);
  for (const track of midi.tracks) {
    for (const note of track.notes) {
      const beatPos = (note.ticks % barTicks) / ppq; // 小節の中で何拍目か（0〜4 未満）
      const beat = Math.floor(beatPos);
      const frac = beatPos - beat;
      const offsetSec = groove[beat] + (groove[(beat + 1) % 4] - groove[beat]) * frac
        + (random() * 2 - 1) * HUMANIZE_TIME_SEC * amount;
      note.ticks = Math.max(0, Math.round(note.ticks + secToTicks(offsetSec, note.ticks)));
      note.velocity = clamp(note.velocity + (random() * 2 - 1) * HUMANIZE_VELOCITY * amount, 0.05, 1);
    }
    track.notes.sort((a, b) => a.ticks - b.ticks);
  }

  return {
    midi,
    report: {
      tempo: `${round(originalBpm)} → ${round(startBpm)}${factor !== 1 ? ` → ${round(endBpm)}（最後）` : ""} BPM`,
      tempoEndFactor: factor,
      groove,
      hatDivision: params.hatDivision,
      hats,
      humanize: amount,
    },
  };
}

// 叩く間隔と MIDI から、編集した MIDI まで一度に作る（ふつうはこれを呼ぶ）
// → { midi, bytes, params, report }
export function editMidiFromTaps(intervalsMs, source) {
  const params = tapToParams(intervalsMs);
  const { midi, report } = editMidiByTaps(source, params, seedFromIntervals(intervalsMs));
  return { midi, bytes: midi.toArray(), params, report };
}

// ── 小さな関数 ──────────────────────────────────

const round = (v) => Math.round(v * 100) / 100;

// 同じ入力からは同じ曲にするため、Math.random ではなく種から作る乱数を使う（mulberry32）
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 叩く間隔から種を作る（同じ叩き方なら同じ揺れ方になる）
export function seedFromIntervals(intervalsMs) {
  let h = 2166136261;
  for (const ms of intervalsMs ?? []) h = Math.imul(h ^ Math.round(ms), 16777619);
  return h >>> 0;
}
