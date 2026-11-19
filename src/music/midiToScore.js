// 【出力・たいが】MIDI → 楽譜（Score）。編集した原曲の MIDI を、鳴らす側（renderSong・sound.js）が使う形にする。
// ここでは音を鳴らさない・ブラウザの機能を使わない（Node でも動く）。
// 受け渡しの形は docs/interfaces.md の「6. 原曲」「7. 楽譜」。
//
// midiToScore(midi, blueprint) → { score, report }
//   midi      @tonejs/midi の Midi（うごてんが設計図で編集したもの）
//   blueprint 設計図（timbre と、音の柔らかさ sound を楽譜に入れるため）
//   score     楽譜（JSON にできる形）
//   report    どのトラックを何にしたか・注意（画面表示・確認用）
//
// トラックの割り当て（原曲の決まりは「6. 原曲」）:
//   melody  名前が melody / lead / vocal のトラック（なければ和音でない一番高いトラック）。同じ時刻に音が重なれば一番高い音
//   pad     名前が pad / chord / string のトラック。同じ時刻の音をまとめて和音にする
//   bass    名前が bass のトラック（なければ残りで一番低いトラック）。同じ時刻に音が重なれば一番低い音
//   kick    ドラムの 35・36 / snare 37〜40 / hat 42・44・46（General MIDI）。それ以外のドラムの音は使わない
//   voice   曲の構成のイントロとアウトロの頭に、本人の声を1回ずつ置く。duration は付けない（声は最後まで流す。
//           速いテンポでも名前などが途中で切れないように）。鳴らすかどうかは assets.voice があるかで決まる
// 曲の構成（structure）: イントロ2小節 → 1問＝2小節 × 10 → アウトロ2小節（4/4 で数える。テンポの変化も反映した秒）
import { normalizeBlueprint } from "../blueprint.js";
import { round } from "../util.js";
import { findParts, avgPitch } from "./parts.js";
import { soundFromBlueprint } from "./soundSettings.js";

export const SECTION_NAMES = ["intro", ...Array.from({ length: 10 }, (_, i) => `q${i + 1}`), "outro"];
export const SECTION_BARS = 2;
const SONG_BARS = SECTION_NAMES.length * SECTION_BARS; // 24 小節
const DRUMS = { kick: [35, 36], snare: [37, 38, 39, 40], hat: [42, 44, 46] };
const MIN_DURATION = 0.01; // 秒。長さ 0 の音を鳴らさないように

export function midiToScore(midi, input) {
  const bp = normalizeBlueprint(input);
  const warnings = [];
  const barTicks = midi.header.ppq * 4;
  const sec = (ticks) => t(midi.header.ticksToSeconds(ticks));

  // 曲の構成: 2小節ずつ区切って、秒に直す
  const structure = SECTION_NAMES.map((name, i) => ({
    name,
    start: sec(i * SECTION_BARS * barTicks),
    end: sec((i + 1) * SECTION_BARS * barTicks),
  }));
  const endTick = Math.max(0, ...midi.tracks.flatMap((tr) => tr.notes.map((n) => n.ticks + n.durationTicks)));
  const bars = Math.ceil((endTick - midi.header.ppq / 4) / barTicks); // ノリ・揺らぎで16分音符までのはみ出しは数えない
  if (bars !== SONG_BARS) warnings.push(`原曲が ${bars} 小節です（決まりは ${SONG_BARS} 小節）。曲の構成の区切りと音楽がずれます`);
  const ts = midi.header.timeSignatures;
  if (ts.some((x) => x.timeSignature[0] !== 4 || x.timeSignature[1] !== 4)) warnings.push("原曲が 4/4 拍子ではないので、曲の構成の区切りがずれます");

  // トラックの割り当て
  const parts = findParts(midi);
  let melody = parts.melody;
  if (!melody) {
    // 名前でも和音かどうかでも見分けられないときは、パッド以外で平均の音が一番高いトラックをメロディにする（楽譜からメロディが消えないように）
    melody = maxBy(parts.pitched.filter((tr) => tr !== parts.pad), avgPitch);
    if (melody) warnings.push(`メロディのトラックを見分けられなかったので、一番高い「${melody.name || "（名前なし）"}」をメロディにしました`);
  }
  const rest = parts.pitched.filter((tr) => tr !== melody && tr !== parts.pad);
  const bass = rest.find((tr) => /bass/i.test(tr.name)) ?? minBy(rest, avgPitch);
  const unused = rest.filter((tr) => tr !== bass).map((tr) => tr.name || "（名前なし）");
  if (unused.length) warnings.push(`使わなかったトラック: ${unused.join("、")}（トラック名を melody / pad / bass / drums にそろえてください）`);

  const tracks = {
    voice: [],
    pad: parts.pad ? chords(parts.pad) : [],
    bass: bass ? mono(bass, "low") : [],
    melody: melody ? mono(melody, "high") : [],
    ...drums(parts.drums, warnings),
  };

  // 声: イントロとアウトロの頭に置き、最後まで流す（声の長さは楽譜では分からないので、renderSong が書き出しを声の終わりまで伸ばす）
  for (const name of ["intro", "outro"]) {
    tracks.voice.push({ time: structure.find((x) => x.name === name).start });
  }

  // 長さ: 最後の音（または構成の最後）+ リバーブの余韻
  const sound = soundFromBlueprint(bp);
  const lastEnd = Math.max(
    structure.at(-1).end,
    ...Object.values(tracks).flat().map((e) => e.time + (e.duration ?? 0)),
  );
  const score = {
    bpm: Math.round(midi.header.tempos[0]?.bpm ?? 120),
    duration: t(lastEnd + sound.reverbDecay),
    timbre: bp.timbre,
    sound,
    structure,
    tracks,
  };
  return {
    score,
    report: {
      bars,
      melodyTrack: melody?.name ?? null,
      padTrack: parts.pad?.name ?? null,
      bassTrack: bass?.name ?? null,
      drumTracks: parts.drums.map((tr) => tr.name),
      counts: Object.fromEntries(Object.entries(tracks).map(([k, v]) => [k, v.length])),
      warnings,
    },
  };
}

// 単音のトラック: 同じ時刻の音は1つ（high なら一番高い音、low なら一番低い音）
function mono(track, pick) {
  return groupByTime(track.notes).map(([time, notes]) => {
    const n = notes.reduce((a, b) => ((pick === "high" ? b.midi > a.midi : b.midi < a.midi) ? b : a));
    return { time, note: n.name, duration: t(Math.max(MIN_DURATION, n.duration)), velocity: round(n.velocity) };
  });
}

// 和音のトラック: 同じ時刻の音をまとめる（低い順）。長さは一番長い音、強さは平均
function chords(track) {
  return groupByTime(track.notes).map(([time, notes]) => {
    const sorted = [...notes].sort((a, b) => a.midi - b.midi);
    const names = [...new Set(sorted.map((n) => n.name))];
    return {
      time,
      notes: names,
      duration: t(Math.max(MIN_DURATION, ...notes.map((n) => n.duration))),
      velocity: round(notes.reduce((s, n) => s + n.velocity, 0) / notes.length),
    };
  });
}

// ドラム: 全ドラムトラックをまとめて kick / snare / hat に分ける。同じ時刻は1つ（強さは一番強いもの）
function drums(drumTracks, warnings) {
  const out = {};
  const all = drumTracks.flatMap((tr) => tr.notes);
  for (const [kind, numbers] of Object.entries(DRUMS)) {
    out[kind] = groupByTime(all.filter((n) => numbers.includes(n.midi))).map(([time, notes]) => ({
      time,
      velocity: round(Math.max(...notes.map((n) => n.velocity))),
    }));
  }
  const known = Object.values(DRUMS).flat();
  const other = [...new Set(all.filter((n) => !known.includes(n.midi)).map((n) => n.midi))];
  if (other.length) warnings.push(`使わなかったドラムの音: ${other.join("・")} 番（使えるのはキック 35・36 / スネア 37〜40 / ハイハット 42・44・46）`);
  return out;
}

// 時刻（ミリ秒にそろえた秒）ごとにまとめ、時刻の順に並べる。同じトラックで同じ time を2回使わないため
function groupByTime(notes) {
  const map = new Map();
  for (const n of notes) {
    const time = t(Math.max(0, n.time));
    if (!map.has(time)) map.set(time, []);
    map.get(time).push(n);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]);
}

const t = (s) => round(s, 3); // 秒はミリ秒まで
const maxBy = (list, score) => list.reduce((best, x) => (best === null || score(x) > score(best) ? x : best), null);
const minBy = (list, score) => list.reduce((best, x) => (best === null || score(x) < score(best) ? x : best), null);
