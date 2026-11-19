// 【声の担当】声の特徴 → 原曲の MIDI を編集する（移調 → メロディの音域 → リバーブ・パッドの柔らかさ）。
// ここでは音を鳴らさない・ブラウザの機能を使わない（Node でも動く）。WAV の読み込みは fromWav.js。
//
// 流れ:
//   features（analyzeVoice の結果）─ voiceToParams() ─→ params ─ editMidiByVoice(midi, params) ─→ 編集した MIDI
//
// voiceToParams(features) → params
//   root         声の高さの音名（"C"〜"B"、シャープだけ）。取れなければ null（移調しない）
//   melodyRange  抑揚（0〜1）。取れなければ 0.5
//   rangeFactor  メロディの音域の倍率（0.6〜1.4）。melodyRange から決める。抑揚なしは 1
//   breathiness  息っぽさ（0〜1）。取れなければ 0.3
//   sound        breathiness から決めたリバーブ・パッドの設定（voiceSound の結果）
//
// editMidiByVoice(midi, params, songKey?) → { midi, report }
//   midi    @tonejs/midi の Midi。元の midi は書き換えず、編集したコピーを返す
//   songKey { root: "D", scale: "dorian" }（原曲のキー）。省くと MIDI の調号 → 音の分布から推定
//   report  何をしたか（画面表示・確認用）
//
// MIDI のトラックの見分け方（原曲を作るときはトラック名をそろえる。docs の案: melody / pad / bass / drums）
//   ドラム: チャンネル10（instrument.percussion）か、名前に drum を含む。移調しない
//   メロディ: 名前に melody / lead / vocal を含む。なければ、ドラム以外で平均の音が一番高いトラック
//   パッド: 名前に pad / chord / string を含む
import { Midi } from "@tonejs/midi";
import { SCALES, NOTES } from "../../blueprint.js";
import { clamp, median } from "../../util.js";

// ── 声の特徴 → 編集の値 ──────────────────────────────

// clarity（澄み具合）は声の高さが取れた所だけの平均なので、実際は 0.5〜1 くらいしか動かない。
// この幅を breathiness 0〜1 に広げる。実際の声を録って調整する前提の目安
const CLARITY_CLEAR = 0.95; // これ以上はっきりしていれば breathiness 0
const CLARITY_BREATHY = 0.55; // これ以下なら breathiness 1
const DEFAULT_RANGE = 0.5;
const DEFAULT_BREATHINESS = 0.3;
const RANGE_MIN_FACTOR = 0.6; // 抑揚 0 のときのメロディの音域の倍率
const RANGE_MAX_FACTOR = 1.4; // 抑揚 1 のとき

export function voiceToParams(features) {
  const f = features ?? {};
  const root = typeof f.pitchNote === "string" ? f.pitchNote.replace(/-?\d+$/, "") : null;
  const melodyRange = isNum(f.pitchVariation) ? clamp(f.pitchVariation, 0, 1) : DEFAULT_RANGE;
  const breathiness = isNum(f.clarity)
    ? clamp((CLARITY_CLEAR - f.clarity) / (CLARITY_CLEAR - CLARITY_BREATHY), 0, 1)
    : DEFAULT_BREATHINESS;
  return {
    root: NOTES.includes(root) ? root : null,
    melodyRange: round(melodyRange),
    rangeFactor: isNum(f.pitchVariation) ? round(lerp(RANGE_MIN_FACTOR, RANGE_MAX_FACTOR, melodyRange)) : 1,
    breathiness: round(breathiness),
    sound: voiceSound(breathiness),
  };
}

// 息っぽさ → リバーブとパッドの設定（Tone.js でそのまま使える数字）
export function voiceSound(breathiness) {
  const b = clamp(isNum(breathiness) ? breathiness : DEFAULT_BREATHINESS, 0, 1);
  return {
    reverbDecay: round(lerp(1.5, 6, b)), // 秒（Tone.Reverb の decay）
    reverbWet: round(lerp(0.15, 0.5, b)), // 0〜1（Tone.Reverb の wet）
    padAttack: round(lerp(0.1, 1.5, b)), // 秒
    padRelease: round(lerp(0.8, 3, b)), // 秒
    padFilterHz: Math.round(expLerp(4000, 900, b)), // ローパスの周波数（耳の感じ方に合わせて対数で補間）
  };
}

// ── MIDI の編集 ──────────────────────────────────

const MELODY_LOW = 55; // G3。音域を広げても、この範囲に収める
const MELODY_HIGH = 88; // E6

export function editMidiByVoice(source, params, songKey = null) {
  const midi = new Midi(source.toArray()); // 元を書き換えないようにコピー
  const parts = findParts(midi);
  const key = normalizeKey(songKey) ?? keyFromText(midi) ?? keyFromHeader(midi) ?? estimateKey(midi, parts);

  // 1. 移調: 声の音名をキーにする。上下の近いほうへ（−6〜+5 半音）
  let shift = 0;
  if (params.root) {
    shift = (NOTES.indexOf(params.root) - NOTES.indexOf(key.root) + 12) % 12;
    if (shift > 5) shift -= 12;
  }
  for (const track of parts.pitched) for (const note of track.notes) note.midi = clamp(note.midi + shift, 0, 127);
  const newRoot = NOTES[(NOTES.indexOf(key.root) + shift + 12) % 12];

  // 2. メロディの音域: 真ん中の音からの距離を rangeFactor 倍し、音階の音に寄せる
  const factor = isNum(params.rangeFactor) ? params.rangeFactor : 1;
  let melodySpan = null;
  if (parts.melody && parts.melody.notes.length) {
    const before = span(parts.melody.notes);
    const center = median(parts.melody.notes.map((n) => n.midi));
    if (factor !== 1) {
      for (const note of parts.melody.notes) {
        const stretched = Math.round(center + (note.midi - center) * factor);
        note.midi = snapToScale(clamp(stretched, MELODY_LOW, MELODY_HIGH), newRoot, key.scale);
      }
    }
    melodySpan = { before, after: span(parts.melody.notes) };
  }

  // 3. リバーブ・パッドの柔らかさ: MIDI のコントロールチェンジとして曲の頭に書く（鳴らす側が読む）
  //    CC91 リバーブの量 / CC73 立ち上がり / CC72 消え方 / CC74 明るさ（いずれも 0〜127）
  const b = isNum(params.breathiness) ? params.breathiness : DEFAULT_BREATHINESS;
  for (const track of parts.pitched) {
    track.addCC({ number: 91, value: lerp(0.15, 0.5, b), time: 0 });
  }
  if (parts.pad) {
    parts.pad.addCC({ number: 73, value: b, time: 0 });
    parts.pad.addCC({ number: 72, value: b, time: 0 });
    parts.pad.addCC({ number: 74, value: 1 - b, time: 0 });
  }

  // 編集後のキーを MIDI に残す（次に編集する人が読めるように）。
  // 調号は長調・短調しか表せず、移調後は古くなるので消し、"key: G# dorian" というテキストで残す
  midi.header.keySignatures = [];
  midi.header.meta = midi.header.meta.filter((m) => !(m.type === "text" && KEY_TEXT.test(m.text)));
  midi.header.meta.push({ type: "text", text: `key: ${newRoot} ${key.scale}`, ticks: 0 });

  return {
    midi,
    report: {
      songKey: `${key.root} ${key.scale}${key.estimated ? "（推定）" : ""}`,
      newKey: `${newRoot} ${key.scale}`,
      shift,
      rangeFactor: factor,
      melodyTrack: parts.melody?.name || null,
      padTrack: parts.pad?.name || null,
      melodySpan,
      breathiness: round(b),
    },
  };
}

// ── トラックの見分け ───────────────────────────────

export function findParts(midi) {
  const tracks = midi.tracks.filter((t) => t.notes.length);
  const isDrum = (t) => t.instrument.percussion || t.channel === 9 || /drum|perc/i.test(t.name);
  const pitched = tracks.filter((t) => !isDrum(t));
  const byName = (re) => pitched.find((t) => re.test(t.name));
  const avg = (t) => t.notes.reduce((a, n) => a + n.midi, 0) / t.notes.length;
  const melody = byName(/melody|lead|vocal/i) ?? [...pitched].sort((a, b) => avg(b) - avg(a))[0] ?? null;
  const pad = byName(/pad|chord|string/i) ?? null;
  return { pitched, melody, pad, drums: tracks.filter(isDrum) };
}

// ── キー ────────────────────────────────────────

function normalizeKey(k) {
  if (!k || !NOTES.includes(k.root)) return null;
  return { root: k.root, scale: k.scale in SCALES ? k.scale : "ionian", estimated: false };
}

// 前に編集したときに残したキー（"key: G# dorian"）。原曲を作るときに同じ形で書いておいてもよい
const KEY_TEXT = /^key:\s*([A-G][#b]?)\s+(\w+)\s*$/i;
function keyFromText(midi) {
  for (const m of midi.header.meta ?? []) {
    const hit = m.type === "text" && KEY_TEXT.exec(m.text);
    if (hit) return normalizeKey({ root: toSharp(hit[1].toUpperCase()[0] + hit[1].slice(1)), scale: hit[2].toLowerCase() });
  }
  return null;
}

// MIDI の調号（"Bb" のようなフラットもあるのでシャープに直す）
function keyFromHeader(midi) {
  const ks = midi.header.keySignatures?.[0];
  if (!ks) return null;
  const root = toSharp(ks.key);
  if (!NOTES.includes(root)) return null;
  return { root, scale: ks.scale === "minor" ? "aeolian" : "ionian", estimated: false };
}

// 調号がないとき: 音の長さで重みを付けた音名の分布から、長調・短調のどれに一番近いかで推定（Krumhansl のプロファイル）
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export function estimateKey(midi, parts = findParts(midi)) {
  const hist = new Array(12).fill(0);
  for (const t of parts.pitched) for (const n of t.notes) hist[n.midi % 12] += n.duration;
  let best = { root: "C", scale: "ionian", score: -Infinity, estimated: true };
  for (let r = 0; r < 12; r++) {
    for (const [profile, scale] of [[MAJOR_PROFILE, "ionian"], [MINOR_PROFILE, "aeolian"]]) {
      const rotated = hist.map((_, i) => hist[(i + r) % 12]);
      const score = correlation(rotated, profile);
      if (score > best.score) best = { root: NOTES[r], scale, score, estimated: true };
    }
  }
  return best;
}

// 音階にない音を、一番近い音階の音に寄せる（同じ距離なら下）
export function snapToScale(midiNote, root, scale) {
  const steps = SCALES[scale] ?? SCALES.ionian;
  const r = NOTES.indexOf(root);
  for (let d = 0; d <= 6; d++) {
    for (const cand of [midiNote - d, midiNote + d]) {
      if (steps.includes((((cand - r) % 12) + 12) % 12)) return cand;
    }
  }
  return midiNote;
}

// ── 小さな関数 ──────────────────────────────────

const FLATS = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#", Cb: "B", Fb: "E" };
const toSharp = (name) => FLATS[name] ?? name;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const lerp = (a, b, t) => a + (b - a) * t;
const expLerp = (a, b, t) => a * Math.pow(b / a, t);
const round = (v) => Math.round(v * 100) / 100;

function span(notes) {
  const m = notes.map((n) => n.midi);
  return { low: Math.min(...m), high: Math.max(...m), semitones: Math.max(...m) - Math.min(...m) };
}

function correlation(a, b) {
  const ma = a.reduce((s, v) => s + v, 0) / a.length;
  const mb = b.reduce((s, v) => s + v, 0) / b.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}
