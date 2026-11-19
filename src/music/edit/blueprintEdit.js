// 【出力・うごてん】設計図（Blueprint）→ 原曲の MIDI を編集する。
// ここでは音を鳴らさない・ブラウザの機能を使わない（Node でも動く）。材料（WAV・叩いた間隔）は見ず、設計図だけを使う。
// 受け渡しの形は docs/interfaces.md の「5. 設計図」「6. 原曲」。
//
// 編集の順番と、使う設計図の項目:
//   声（sources.voice があるとき）
//     1. 移調          root         原曲を、このキーに移調する（rootFromVoice が true のときだけ。音階は原曲のまま。ドラムは移調しない）
//     2. メロディの音域 melodyRange  真ん中の音からの距離を 0.6〜1.4 倍にし、音階の音に寄せる
//     3. 音の柔らかさ   breathiness  リバーブ・パッドの設定を CC として曲の頭に書く（数字は src/music/soundSettings.js の soundFromBlueprint。鳴らす側と同じ）
//   叩く（sources.taps があるとき。4/4 拍子の曲だけ）
//     4. ドラムの細かさ stability・bpm  ハイハットを 4分・8分・16分で刻み直す（原曲でハイハットが鳴っていた小節だけ）
//   テンポ（sources.taps か sources.heart があるとき）
//     5. テンポ        bpm          原曲のテンポの変化は残したまま、全体を「bpm ÷ 原曲の最初の bpm」倍にする
//     6. テンポの変化   tempoDrift   1小節ごとに少しずつ、最後に tempoDrift 倍になるように変える（taps があるときだけ）
//   叩く（続き）
//     7. ノリ・揺らぎ   groove・stability  拍の位置に合わせて時刻をずらし、バラつきの分だけ時刻と強さを揺らす
//   材料がない所は原曲のまま。
//
// editMidiByBlueprint(midi, blueprint, songKey?) → { midi, report }
//   midi      @tonejs/midi の Midi。元の midi は書き換えず、編集したコピーを返す
//   blueprint 設計図。中で normalizeBlueprint() を通す
//   songKey   { root: "D", scale: "dorian" }（原曲のキー）。省くと MIDI の "key: D dorian" テキスト → 調号 → 音の分布から推定
//   report    何をしたか（画面表示・確認用）
import { NOTES, SCALES, normalizeBlueprint } from "../../blueprint.js";
import { clamp, median, round, seededRandom, hashString } from "../../util.js";
import { findParts, isDrum } from "../parts.js";
import { soundFromBlueprint } from "../soundSettings.js";

const RANGE_MIN_FACTOR = 0.6; // melodyRange 0 のときのメロディの音域の倍率
const RANGE_MAX_FACTOR = 1.4; // melodyRange 1 のとき
const RANGE_MARGIN = 7; // 音域を広げても、原曲のメロディの一番低い・高い音から 7 半音までに収める
const CLOSED_HAT = 42; // General MIDI のクローズド・ハイハット
const HUMANIZE_TIME_SEC = 0.02; // 揺らぎ 1 のとき、音の時刻を最大 ±20ms ずらす
const HUMANIZE_VELOCITY = 0.12; // 揺らぎ 1 のとき、音の強さを最大 ±0.12 変える
const SOUND_CC = { reverb: 91, attack: 73, release: 72, brightness: 74 };

export function editMidiByBlueprint(source, input, songKey = null) {
  const bp = normalizeBlueprint(input);
  const midi = source.clone(); // 元を書き換えないようにコピー
  const parts = findParts(midi);
  const warnings = [];
  const useVoice = bp.sources.voice;
  const useTaps = bp.sources.taps;
  const useTempo = bp.sources.taps || bp.sources.heart;
  const ppq = midi.header.ppq;
  const barTicks = ppq * 4;
  const is44 = isFourFour(midi);
  if (useTaps && !is44) warnings.push("原曲が 4/4 拍子ではないので、ドラムの細かさ・ノリは変えませんでした");

  const key = normalizeKey(songKey) ?? keyFromText(midi) ?? keyFromHeader(midi) ?? estimateKey(midi);
  if (key.estimated) warnings.push("原曲のキーを音の分布から推定しました。曲ごとのキーを渡すと確実です");

  // 1. 移調: 設計図の root をキーにする。上下の近いほうへ（−6〜+5 半音）。
  //    声の高さが取れなかったとき（rootFromVoice が false）は、声があっても原曲のキーのまま
  let shift = 0;
  if (useVoice && bp.rootFromVoice) {
    shift = (NOTES.indexOf(bp.root) - NOTES.indexOf(key.root) + 12) % 12;
    if (shift > 5) shift -= 12;
    for (const track of parts.pitched) for (const note of track.notes) note.midi = clamp(note.midi + shift, 0, 127);
  }
  const newRoot = NOTES[(NOTES.indexOf(key.root) + shift + 12) % 12];

  // 2. メロディの音域: 真ん中の音からの距離を倍にし、原曲の音域 ± RANGE_MARGIN の中で音階の音に寄せる
  const rangeFactor = useVoice ? round(lerp(RANGE_MIN_FACTOR, RANGE_MAX_FACTOR, bp.melodyRange)) : 1;
  let melodySpan = null;
  if (!parts.melody) {
    if (rangeFactor !== 1) warnings.push("メロディのトラックが見つからないので、音域は変えませんでした");
  } else {
    const before = span(parts.melody.notes);
    if (rangeFactor !== 1) {
      const center = median(parts.melody.notes.map((n) => n.midi));
      const lo = Math.max(0, before.low - RANGE_MARGIN);
      const hi = Math.min(127, before.high + RANGE_MARGIN);
      for (const note of parts.melody.notes) {
        const stretched = clamp(Math.round(center + (note.midi - center) * rangeFactor), lo, hi);
        note.midi = snapToScale(stretched, newRoot, key.scale, lo, hi);
      }
    }
    melodySpan = { before, after: span(parts.melody.notes) };
  }

  // 3. 音の柔らかさ: リバーブ・パッドの設定を CC で曲の頭に書く。原曲に同じ番号の CC があれば消す（上書きされないように）
  const sound = soundFromBlueprint(bp);
  if (useVoice) {
    const cc = soundToCC(sound);
    for (const track of parts.pitched) {
      track.controlChanges[SOUND_CC.reverb] = [];
      track.addCC({ number: SOUND_CC.reverb, value: cc.reverb, ticks: 0 });
    }
    if (parts.pad) {
      for (const name of ["attack", "release", "brightness"]) {
        parts.pad.controlChanges[SOUND_CC[name]] = [];
        parts.pad.addCC({ number: SOUND_CC[name], value: cc[name], ticks: 0 });
      }
    }
  }

  // 4. ドラムの細かさ: ハイハットが一番多いトラックだけ、原曲でハイハットが鳴っていた小節を刻み直す
  const endTick = Math.max(0, ...midi.tracks.flatMap((t) => t.notes.map((n) => n.ticks + n.durationTicks)));
  const bars = Math.max(1, Math.ceil(endTick / barTicks));
  const hatDiv = useTaps && is44 ? hatDivision(bp.bpm, bp.stability) : null;
  let hats = null;
  const hatTrack = maxBy(parts.drums, (t) => t.notes.filter((n) => n.midi === CLOSED_HAT).length);
  if (hatDiv && hatTrack) {
    const old = hatTrack.notes.filter((n) => n.midi === CLOSED_HAT);
    if (old.length) {
      const hatBars = new Set(old.map((n) => Math.floor(n.ticks / barTicks)));
      const velocity = median(old.map((n) => n.velocity));
      const step = barTicks / hatDiv;
      hatTrack.notes = hatTrack.notes.filter((n) => n.midi !== CLOSED_HAT);
      for (const bar of hatBars) {
        for (let t = bar * barTicks; t < (bar + 1) * barTicks; t += step) {
          const onBeat = t % ppq === 0;
          hatTrack.addNote({ midi: CLOSED_HAT, ticks: Math.round(t), durationTicks: Math.round(step / 2), velocity: onBeat ? velocity : velocity * 0.7 });
        }
      }
      hats = { division: hatDiv, before: old.length, after: hatTrack.notes.filter((n) => n.midi === CLOSED_HAT).length };
    }
  }

  // 5・6. テンポとテンポの変化: 原曲のテンポの点はそのまま残し、全体の倍率と小節ごとの変化を掛ける
  const original = midi.header.tempos.length ? midi.header.tempos.map((t) => ({ ticks: t.ticks, bpm: t.bpm })) : [{ ticks: 0, bpm: 120 }];
  const originalBpm = original[0].bpm;
  const ratio = useTempo ? bp.bpm / originalBpm : 1;
  const drift = useTaps ? bp.tempoDrift : 1;
  if (ratio !== 1 || drift !== 1) {
    const bpmOf = (ticks) => original.filter((t) => t.ticks <= ticks).at(-1)?.bpm ?? originalBpm;
    const rampOf = (ticks) => (bars < 2 ? 1 : 1 + ((drift - 1) * Math.min(Math.floor(ticks / barTicks), bars - 1)) / (bars - 1));
    const points = new Set(original.map((t) => t.ticks));
    if (drift !== 1) for (let bar = 0; bar < bars; bar++) points.add(bar * barTicks);
    midi.header.tempos = [...points].sort((a, b) => a - b).map((ticks) => ({ ticks, bpm: round(bpmOf(ticks) * ratio * rampOf(ticks)) }));
    midi.header.update();
  }
  const tempos = midi.header.tempos;
  const bpmAt = (ticks) => tempos.filter((t) => t.ticks <= ticks).at(-1)?.bpm ?? tempos[0]?.bpm ?? 120;

  // 7. ノリと揺らぎ: 拍の中の位置に合わせて groove のズレを足し（拍と拍の間は前後のズレを直線でつなぐ）、
  //    揺らぎ（1 − stability）の分だけ時刻と強さを揺らす。同じトラック・同じ時刻の音（和音）は同じだけずらす
  const humanize = useTaps ? round(1 - bp.stability) : 0;
  const hasGroove = useTaps && is44 && bp.groove.some((s) => s !== 0);
  if (hasGroove || humanize > 0) {
    const random = seededRandom(hashString(JSON.stringify(bp)));
    for (const track of midi.tracks) {
      const shiftAt = new Map(); // 元の時刻 → ずらす秒
      for (const note of track.notes) {
        if (!shiftAt.has(note.ticks)) {
          let sec = (random() * 2 - 1) * HUMANIZE_TIME_SEC * humanize;
          if (hasGroove) {
            const beatPos = (note.ticks % barTicks) / ppq; // 小節の中で何拍目か（0〜4 未満）
            const beat = Math.floor(beatPos);
            sec += bp.groove[beat] + (bp.groove[(beat + 1) % 4] - bp.groove[beat]) * (beatPos - beat);
          }
          shiftAt.set(note.ticks, sec);
        }
        const sec = shiftAt.get(note.ticks);
        note.ticks = Math.max(0, Math.round(note.ticks + (sec * bpmAt(note.ticks) * ppq) / 60));
        note.velocity = clamp(note.velocity + (random() * 2 - 1) * HUMANIZE_VELOCITY * humanize, 0.05, 1);
      }
      track.notes.sort((a, b) => a.ticks - b.ticks);
    }
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
      melodyTrack: parts.melody?.name || null,
      rangeFactor,
      melodySpan,
      sound: useVoice ? sound : null,
      tempo: ratio === 1 && drift === 1
        ? `${round(originalBpm)} BPM（原曲のまま）`
        : `${round(originalBpm)} → ${round(originalBpm * ratio)}${drift !== 1 ? ` → ${round(originalBpm * ratio * drift)}（最後）` : ""} BPM`,
      tempoDrift: drift,
      groove: hasGroove ? bp.groove : null,
      hats,
      humanize,
      warnings,
    },
  };
}

// 設計図と MIDI から、編集した MIDI のバイト列まで一度に作る → { midi, bytes, report }
export function editMidiFromBlueprint(source, blueprint, songKey = null) {
  const { midi, report } = editMidiByBlueprint(source, blueprint, songKey);
  return { midi, bytes: midi.toArray(), report };
}

// ── 音の柔らかさ ─────────────────────────────────

// 音の設定（soundFromBlueprint、src/music/soundSettings.js）→ MIDI の CC の値（0〜1。@tonejs/midi が 0〜127 にする）。数字の出どころを soundFromBlueprint の1か所にするため
function soundToCC(sound) {
  return {
    reverb: sound.reverbWet,
    attack: clamp(sound.padAttack / 2, 0, 1),
    release: clamp(sound.padRelease / 4, 0, 1),
    brightness: clamp(Math.log(sound.padFilterHz / 200) / Math.log(8000 / 200), 0, 1),
  };
}

// ── 小さな判定 ──────────────────────────────────
// トラックの見分け（findParts・isDrum）は src/music/parts.js（楽譜の側と共通）

// ゆっくり安定して叩く人は細かく（16分）、バラつきの大きい人は間引く（4分）、それ以外は 8分
function hatDivision(bpm, stability) {
  if (stability < 0.25) return 4;
  if (bpm < 100 && stability >= 0.5) return 16;
  return 8;
}

function isFourFour(midi) {
  const ts = midi.header.timeSignatures;
  return !ts.length || ts.every((t) => t.timeSignature[0] === 4 && t.timeSignature[1] === 4);
}

// ── 原曲のキー ──────────────────────────────────

const SCALE_ALIASES = { major: "ionian", minor: "aeolian" };

function normalizeKey(k) {
  if (!k || !NOTES.includes(k.root)) return null;
  const scale = SCALE_ALIASES[k.scale] ?? k.scale;
  return { root: k.root, scale: scale in SCALES ? scale : "ionian", estimated: false };
}

// "key: D dorian" / "key: A minor" のテキスト（原曲を作るときに書いておく。編集した MIDI にもこの形で残す）
const KEY_TEXT = /^key:\s*([A-G][#b]?)\s+(\w+)\s*$/i;
function keyFromText(midi) {
  for (const m of midi.header.meta ?? []) {
    const hit = m.type === "text" && KEY_TEXT.exec(m.text);
    if (hit) return normalizeKey({ root: toSharp(hit[1][0].toUpperCase() + hit[1].slice(1)), scale: hit[2].toLowerCase() });
  }
  return null;
}

// MIDI の調号（"Bb" のようなフラットもあるのでシャープに直す）
function keyFromHeader(midi) {
  const ks = midi.header.keySignatures?.[0];
  if (!ks) return null;
  return normalizeKey({ root: toSharp(ks.key), scale: ks.scale === "minor" ? "aeolian" : "ionian" });
}

// キーの記録がないとき: 音の長さで重みを付けた音名の分布から、長調・短調のどれに一番近いかで推定（Krumhansl のプロファイル）。
// dorian などの曲は関係調（D dorian → C 長調）と判定されることがあるので、最後の手段
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export function estimateKey(midi) {
  const hist = new Array(12).fill(0);
  for (const t of midi.tracks) if (!isDrum(t)) for (const n of t.notes) hist[n.midi % 12] += n.duration;
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

// 音階にない音を、lo〜hi の中で一番近い音階の音に寄せる（同じ距離なら下）
export function snapToScale(midiNote, root, scale, lo = 0, hi = 127) {
  const steps = SCALES[scale] ?? SCALES.ionian;
  const r = NOTES.indexOf(root);
  for (let d = 0; d <= 6; d++) {
    for (const cand of [midiNote - d, midiNote + d]) {
      if (cand >= lo && cand <= hi && steps.includes((((cand - r) % 12) + 12) % 12)) return cand;
    }
  }
  return midiNote;
}

// ── 小さな関数 ──────────────────────────────────

const FLATS = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#", Cb: "B", Fb: "E" };
const toSharp = (name) => FLATS[name] ?? name;
const lerp = (a, b, t) => a + (b - a) * t;
const maxBy = (list, score) => list.reduce((best, x) => (best === null || score(x) > score(best) ? x : best), null);

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
