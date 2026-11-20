// 【出力・たいが】MIDI → 楽譜（Score）。編集した原曲の MIDI を、鳴らす側（renderSong・sound.js）が使う形にする。
// ここでは音を鳴らさない・ブラウザの機能を使わない（Node でも動く）。
// 受け渡しの形は docs/interfaces.md の「6. 原曲」「7. 楽譜」。
//
// midiToScore(midi, blueprint, layout?) → { score, report }
//   midi      @tonejs/midi の Midi（うごてんが設計図で編集したもの）
//   blueprint 設計図（timbre と、音の柔らかさ sound を楽譜に入れるため）
//   layout    曲の構成の小節の数 { introBars, barsPerQuestion, outroBars, totalBars }（src/music/edit/layout.js の planLayout）。
//             省くと DEFAULT_LAYOUT（イントロ2 → 1問2小節 × 10 → アウトロ2）
//   score     楽譜（JSON にできる形）
//   report    どのトラックを何にしたか・注意（画面表示・確認用）
//
// トラックの割り当て（原曲の決まりは「6. 原曲」）:
//   melody  名前が melody / lead / vocal のトラック（なければ和音でない一番高いトラック）。同じ時刻に音が重なれば一番高い音
//   pad     名前が pad / chord / string のトラック。同じ時刻の音をまとめて和音にする（最大 PAD_MAX_NOTES 音）。
//           同じ和音が続けて鳴り直すところは1つの長い音にまとめる（採譜で細かく刻まれた和音で、消え方の長い音が
//           積み重なって同時に鳴る数の上限を超え、音が抜けたり書き出しが遅くなったりしないように）
//   bass    名前が bass のトラック（なければ残りで一番低いトラック）。同じ時刻に音が重なれば一番低い音
//   kick    ドラムの 35・36 / snare 37〜40 / hat 42・44・46（General MIDI）。それ以外のドラムの音は使わない
//   voice   曲の構成のイントロとアウトロの頭に、本人の声を1回ずつ置く。duration は付けない（声は最後まで流す。
//           速いテンポでも名前などが途中で切れないように）。鳴らすかどうかは assets.voice があるかで決まる
// 曲の構成（structure）: layout の小節の数で intro → q1〜q10 → outro に区切る（4/4 で数える。テンポの変化も反映した秒）
// フェード（fade）: アウトロの頭から終わりまでで、音楽を 0 まで下げる（sound.js）。声はフェードしない
// 長さ（duration）: アウトロの終わり + FADE_TAIL 秒（声が長ければ renderSong が声の終わりまで伸ばす）
import { normalizeBlueprint } from "../blueprint.js";
import { round } from "../util.js";
import { findParts, avgPitch } from "./parts.js";
import { soundFromBlueprint } from "./soundSettings.js";
import { DEFAULT_LAYOUT } from "./edit/layout.js";

export const SECTION_NAMES = ["intro", ...Array.from({ length: 10 }, (_, i) => `q${i + 1}`), "outro"];
const FADE_TAIL = 0.5; // 秒。フェードが終わってから曲を終えるまで
const DRUMS = { kick: [35, 36], snare: [37, 38, 39, 40], hat: [42, 44, 46] };
const MIN_DURATION = 0.01; // 秒。長さ 0 の音を鳴らさないように
const PAD_MAX_NOTES = 4; // パッドの和音は最大4音（一番低い音と高い音は残し、間を間引く）
const PAD_MERGE_GAP = 0.25; // 秒。同じ和音がこの間をあけずに続けて鳴り直すときは、1つの音にまとめる

export function midiToScore(midi, input, layout = DEFAULT_LAYOUT) {
  const bp = normalizeBlueprint(input);
  const warnings = [];
  const barTicks = midi.header.ppq * 4;
  const sec = (ticks) => t(midi.header.ticksToSeconds(ticks));

  // 曲の構成: layout の小節の数で区切って、秒に直す
  const sectionBars = SECTION_NAMES.map((name) => (name === "intro" ? layout.introBars : name === "outro" ? layout.outroBars : layout.barsPerQuestion));
  const songBars = sectionBars.reduce((a, b) => a + b, 0);
  let barAt = 0;
  const structure = SECTION_NAMES.map((name, i) => {
    const section = { name, start: sec(barAt * barTicks), end: sec((barAt + sectionBars[i]) * barTicks) };
    barAt += sectionBars[i];
    return section;
  });
  const endTick = Math.max(0, ...midi.tracks.flatMap((tr) => tr.notes.map((n) => n.ticks + n.durationTicks)));
  const bars = Math.ceil((endTick - midi.header.ppq / 4) / barTicks); // ノリ・揺らぎで16分音符までのはみ出しは数えない
  if (bars !== songBars) warnings.push(`曲が ${bars} 小節です（曲の構成は ${songBars} 小節）。曲の構成の区切りと音楽がずれます`);
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

  // フェードと長さ: アウトロの間に音楽を消し、少し間をおいて終わる。終わりより後の音は鳴らさない
  const sound = soundFromBlueprint(bp);
  const outro = structure.at(-1);
  const fade = { start: outro.start, end: outro.end };
  const duration = t(outro.end + FADE_TAIL);
  for (const name of Object.keys(tracks)) {
    if (name === "voice") continue;
    tracks[name] = tracks[name]
      .filter((e) => e.time < fade.end)
      .map((e) => (e.duration === undefined ? e : { ...e, duration: t(Math.max(MIN_DURATION, Math.min(e.duration, duration - e.time))) }));
  }
  const score = {
    bpm: Math.round(midi.header.tempos[0]?.bpm ?? 120),
    duration,
    timbre: bp.timbre,
    sound,
    structure,
    fade,
    tracks,
  };
  return {
    score,
    report: {
      bars,
      layout: { introBars: layout.introBars, barsPerQuestion: layout.barsPerQuestion, outroBars: layout.outroBars, totalBars: songBars },
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

// 和音のトラック: 同じ時刻に始まる音をまとめる（低い順・最大 PAD_MAX_NOTES 音）。長さは一番長い音、強さは平均。
// まとめる前に、同じ高さの音が前の音の終わりから PAD_MERGE_GAP 秒以内に鳴り直すときは、前の音を伸ばして1つにする
// （和音が変わっても続く音は鳴らし直さない。パッドらしく音がつながり、同時に鳴る数も減る）
function chords(track) {
  const merged = [];
  const lastByPitch = new Map();
  for (const n of [...track.notes].sort((a, b) => a.time - b.time || a.midi - b.midi)) {
    const start = Math.max(0, n.time);
    const end = start + Math.max(MIN_DURATION, n.duration);
    const last = lastByPitch.get(n.midi);
    if (last && start - last.end <= PAD_MERGE_GAP) {
      last.end = Math.max(last.end, end);
      continue;
    }
    const note = { time: start, end, midi: n.midi, name: n.name, velocity: n.velocity };
    merged.push(note);
    lastByPitch.set(n.midi, note);
  }
  return groupByTime(merged).map(([time, notes]) => {
    const kept = thinChord([...notes].sort((a, b) => a.midi - b.midi));
    return {
      time,
      notes: kept.map((n) => n.name),
      duration: t(Math.max(MIN_DURATION, ...kept.map((n) => n.end - n.time))),
      velocity: round(kept.reduce((s, n) => s + n.velocity, 0) / kept.length),
    };
  });
}

// 低い順の音から、最大 PAD_MAX_NOTES 音を選ぶ（一番低い音と高い音は必ず残し、間は等間隔に選ぶ）
function thinChord(sorted) {
  if (sorted.length <= PAD_MAX_NOTES) return sorted;
  const last = sorted.length - 1;
  return Array.from({ length: PAD_MAX_NOTES }, (_, i) => sorted[Math.round((i * last) / (PAD_MAX_NOTES - 1))]);
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
