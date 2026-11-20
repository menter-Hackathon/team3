// 【出力・うごてん】設計図（Blueprint）→ 原曲の MIDI を編集する。
// ここでは音を鳴らさない・ブラウザの機能を使わない（Node でも動く）。材料（WAV・叩いた間隔）は見ず、設計図だけを使う。
// 受け渡しの形は docs/interfaces.md の「5. 設計図」「6. 原曲」。
//
// 編集の順番と、使う設計図の項目:
//   声（sources.voice があるとき）
//     1. 移調          root         原曲を、このキーに移調する（rootFromVoice が true のときだけ。ドラムは移調しない）
//   10問（sources.quiz があるとき）
//     1b. 音階         scale        原曲の音階を、設計図の音階に置き換える（主音は 1 のまま。「何番目の音か」を保って入れ替える）
//     2. メロディの音域 melodyRange  真ん中の音からの距離を倍にし（0 → 0.3倍・0.5 → 1倍・1 → 2.2倍の折れ線）、音階の音に寄せる。
//                     原曲の音域 ± 12 半音・C3〜C7 からはみ出すときは、メロディ全体の倍率を下げて収める
//     3. 音の柔らかさ   breathiness  リバーブ・パッドの設定を CC として曲の頭に書く（数字は src/music/soundSettings.js の soundFromBlueprint。鳴らす側と同じ）
//   叩く（sources.taps があるとき。4/4 拍子の曲だけ）
//     4. ドラムの細かさ stability・bpm  ハイハットを 4分・8分・16分で刻み直す（原曲でハイハットが鳴っていた小節だけ）
//                     安定度 0.35 未満 → 4分、120 BPM 未満で 0.6 以上 → 16分、それ以外 → 8分
//   テンポ（sources.taps か sources.heart があるとき）
//     5. テンポ        bpm          原曲のテンポの変化は残したまま、全体を「bpm ÷ 原曲の最初の bpm」倍にする
//     6. テンポの変化   tempoDrift   1小節ごとに少しずつ、最後に「tempoDrift の変化 × 2.5」倍になるように変える（±10% → ±25%。taps があるときだけ）
//   10問（続き。sources.quiz があるとき）
//     4b. 音の多さ      density      0.5 で原曲のまま。低いとメロディ・キック・スネアの弱い位置の音を間引き、高いとスネアの小さな音を足す
//     4c. 区間の盛り上がり sections.energy  1問ごとの区間で音の強さを変える（0 → 0.65 倍・0.5 → そのまま・1 → 1 までの残りの半分を足す）。
//                     低い区間ではハイハットを抜く
//     4d. 区間の迷い    sections.hesitation  迷った問の区間は、頭のメロディを休む（半拍か1拍。長い音は頭を遅らせて残す）
//     （区間の明るさ sections.brightness は音の側で効かせる：midiToScore → score.sections → sound.js のフィルター）
//   5・6 の数字は tempoPlan() で決める（曲の長さを決める layout.js の planLayout も同じ数字を使う）
//   叩く（続き）
//     7. ノリ・揺らぎ   groove・stability  拍の位置に合わせて時刻を groove の 2 倍ずらし（1拍の 1/4 まで）、
//                     バラつきの分だけ時刻（最大 ±45ms）と強さ（最大 ±0.3）を揺らす
//   効き方は、その人らしさがはっきり出るように強めにしてある（設計図の範囲は変えず、ここの倍率で強くする）
//   材料がない所は原曲のまま。
//
// editMidiByBlueprint(midi, blueprint, songKey?) → { midi, report }
//   midi      @tonejs/midi の Midi。元の midi は書き換えず、編集したコピーを返す
//   blueprint 設計図。中で normalizeBlueprint() を通す
//   songKey   { root: "D", scale: "dorian" }（原曲のキー）。省くと MIDI の "key: D dorian" テキスト → 調号 → 音の分布から推定
//   bars      曲の小節の数（省略可。compose は planLayout の totalBars を渡す）。省くと layout の totalBars、それもなければ最後の音から数える
//   layout    曲の構成の小節の数（省略可。planLayout の戻り値）。1問ごとの区間（4c・4d）の位置に使う。省くと DEFAULT_LAYOUT
//   report    何をしたか（画面表示・確認用）
import { NOTES, SCALES, SECTION_COUNT, normalizeBlueprint } from "../../blueprint.js";
import { clamp, median, round, seededRandom, hashString } from "../../util.js";
import { findParts, isDrum, DRUM_NOTES } from "../parts.js";
import { soundFromBlueprint } from "../soundSettings.js";
import { DEFAULT_LAYOUT } from "./layout.js";

const RANGE_MIN_FACTOR = 0.3; // melodyRange 0 のときのメロディの音域の倍率（抑揚の小さい声 → ほとんど平らなメロディ）
const RANGE_MAX_FACTOR = 2.2; // melodyRange 1 のとき（抑揚の大きい声 → 上下に大きく動くメロディ）
const RANGE_MARGIN = 12; // 音域を広げても、原曲のメロディの一番低い・高い音から 12 半音までに収める
const MELODY_LOWEST = 48; // それでも C3〜C7 の外には出さない（低すぎて濁る・高すぎて耳に痛い音にならないように）
const MELODY_HIGHEST = 96;
const CLOSED_HAT = 42; // General MIDI のクローズド・ハイハット
const HUMANIZE_TIME_SEC = 0.045; // 揺らぎ 1 のとき、音の時刻を最大 ±45ms ずらす
const HUMANIZE_VELOCITY = 0.3; // 揺らぎ 1 のとき、音の強さを最大 ±0.3 変える
const GROOVE_GAIN = 2; // 叩いたズレ（groove）を何倍にして曲に入れるか
const GROOVE_MAX_BEATS = 0.25; // ノリのズレは 1拍の 1/4 まで（16分音符ぶん以上ずれると、リズムが別物になるため）
const DRIFT_GAIN = 2.5; // テンポの変化（tempoDrift）を何倍にするか（設計図の ±10% → 曲では ±25%）
const SOUND_CC = { reverb: 91, attack: 73, release: 72, brightness: 74 };
const DENSITY_THIN_MAX = 0.6; // density 0 のとき、弱い位置の音を間引く割合
const DENSITY_ADD_MAX = 0.35; // density 1 のとき、空いている16分音符の位置にスネアの小さな音を足す割合
const GHOST_SNARE = 38;
const GHOST_VELOCITY = 0.25;
const KICKS_SNARES = [...DRUM_NOTES.kick, ...DRUM_NOTES.snare];
const ENERGY_VELOCITY_MIN = 0.65; // energy 0 のときの音の強さの倍率（0.5 で 1 倍）
const ENERGY_BOOST_MAX = 0.5; // energy 1 のとき、音の強さを 1 までの残りの半分だけ上げる（大きい音も小さい音も強くなる）
const ENERGY_SPARSE = 0.4; // これ未満の区間はハイハットを抜く（静かな区間。スネアは残して拍は保つ）

export function editMidiByBlueprint(source, input, songKey = null, { bars: barsOption = null, layout = null } = {}) {
  const bp = normalizeBlueprint(input);
  const midi = source.clone(); // 元を書き換えないようにコピー
  const parts = findParts(midi);
  const warnings = [];
  const useVoice = bp.sources.voice;
  const useTaps = bp.sources.taps;
  const useQuiz = bp.sources.quiz;
  const songBars = barsOption ?? layout?.totalBars ?? null;
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

  // 1b. 音階: 原曲の音階の「何番目の音か」を保ったまま、設計図の音階の同じ番目の音にする（和音の流れが崩れにくい）。
  //     音階にない音（経過音など）は、すぐ下の音階の音と同じだけ動かす。ドラムは変えない
  const newScale = useQuiz && bp.scale in SCALES ? bp.scale : key.scale;
  let scaleNotes = 0;
  if (newScale !== key.scale && key.scale in SCALES) {
    const rootPc = NOTES.indexOf(newRoot);
    for (const track of parts.pitched) {
      for (const note of track.notes) {
        const moved = changeMode(note.midi, rootPc, SCALES[key.scale], SCALES[newScale]);
        if (moved !== note.midi) scaleNotes++;
        note.midi = moved;
      }
    }
  }

  // 2. メロディの音域: 真ん中の音からの距離を倍にし、原曲の音域 ± RANGE_MARGIN の中で音階の音に寄せる。
  //    範囲からはみ出すときは、1音ずつ端に押し込まず、メロディ全体の倍率を下げてちょうど収める（端に音が固まらないように）
  let rangeFactor = useVoice ? rangeFactorFor(bp.melodyRange) : 1;
  let melodySpan = null;
  if (!parts.melody) {
    if (rangeFactor !== 1) warnings.push("メロディのトラックが見つからないので、音域は変えませんでした");
  } else {
    const before = span(parts.melody.notes);
    if (rangeFactor !== 1) {
      const center = median(parts.melody.notes.map((n) => n.midi));
      const lo = Math.max(Math.min(MELODY_LOWEST, before.low), before.low - RANGE_MARGIN);
      const hi = Math.min(Math.max(MELODY_HIGHEST, before.high), before.high + RANGE_MARGIN);
      if (rangeFactor > 1) {
        // lo・hi は原曲の音域をふくむので、収まる倍率は 1 以上になる
        const above = before.high - center;
        const below = center - before.low;
        const fit = Math.min(above > 0 ? (hi - center) / above : Infinity, below > 0 ? (center - lo) / below : Infinity);
        rangeFactor = round(Math.max(1, Math.min(rangeFactor, fit)));
      }
      for (const note of parts.melody.notes) {
        const stretched = clamp(Math.round(center + (note.midi - center) * rangeFactor), lo, hi);
        note.midi = snapToScale(stretched, newRoot, newScale, lo, hi);
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
  // 曲の小節の数（テンポの変化を広げる長さ）。compose は planLayout の totalBars を渡す（最後の小節が休みでも、見込みどおりの長さになるように）
  const bars = songBars ?? Math.max(1, Math.ceil(endTick / barTicks));
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

  // 4b. 音の多さ（10問）
  let density = null;
  if (useQuiz && bp.density !== 0.5) density = applyDensity(midi, parts, bp, is44);

  // 4c・4d. 1問ごとの区間（10問）: 盛り上がり（音の強さ・楽器の数）と迷い（頭のメロディを休む）
  let sectionReport = null;
  if (useQuiz) sectionReport = applySections(midi, parts, bp, sectionRanges(layout ?? DEFAULT_LAYOUT, barTicks));

  // 5・6. テンポとテンポの変化: 原曲のテンポの点はそのまま残し、全体の倍率と小節ごとの変化を掛ける
  const original = midi.header.tempos.length ? midi.header.tempos.map((t) => ({ ticks: t.ticks, bpm: t.bpm })) : [{ ticks: 0, bpm: 120 }];
  const { originalBpm, ratio, drift } = tempoPlan(bp, midi);
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
  const grooveLimitAt = (ticks) => (GROOVE_MAX_BEATS * 60) / bpmAt(ticks); // ノリのズレの上限（秒）

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
            const groove = GROOVE_GAIN * (bp.groove[beat] + (bp.groove[(beat + 1) % 4] - bp.groove[beat]) * (beatPos - beat));
            sec += clamp(groove, -grooveLimitAt(note.ticks), grooveLimitAt(note.ticks));
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
  midi.header.meta.push({ type: "text", text: `key: ${newRoot} ${newScale}`, ticks: 0 });

  return {
    midi,
    report: {
      songKey: `${key.root} ${key.scale}${key.estimated ? "（推定）" : ""}`,
      newKey: `${newRoot} ${newScale}`,
      shift,
      scale: newScale !== key.scale ? { from: key.scale, to: newScale, notes: scaleNotes } : null,
      density,
      sections: sectionReport,
      melodyTrack: parts.melody?.name || null,
      rangeFactor,
      melodySpan,
      sound: useVoice ? sound : null,
      tempo: ratio === 1 && drift === 1
        ? `${round(originalBpm)} BPM（原曲のまま）`
        : `${round(originalBpm)} → ${round(originalBpm * ratio)}${drift !== 1 ? ` → ${round(originalBpm * ratio * drift)}（最後）` : ""} BPM`,
      tempoDrift: drift,
      // 実際にかけたズレ（GROOVE_GAIN 倍し、曲の最初のテンポで 1/4 拍までにしたもの）
      groove: hasGroove ? bp.groove.map((s) => round(clamp(s * GROOVE_GAIN, -grooveLimitAt(0), grooveLimitAt(0)), 3)) : null,
      hats,
      humanize,
      warnings,
    },
  };
}

// ── 10問（音階・音の多さ・区間） ─────────────────────

// 音階を入れ替える（1b）。rootPc は主音（0〜11）、from・to は SCALES の音程の並び
export function changeMode(midiNote, rootPc, from, to) {
  const rel = (((midiNote - rootPc) % 12) + 12) % 12;
  let d = 0;
  while (d + 1 < from.length && from[d + 1] <= rel) d++;
  return clamp(midiNote + to[d] - from[d], 0, 127);
}

// 音の多さ（4b）→ { removed, added }。同じ設計図なら同じ音を間引く・足す（設計図から作った種の乱数）
function applyDensity(midi, parts, bp, is44) {
  const ppq = midi.header.ppq;
  const random = seededRandom(hashString(`${JSON.stringify(bp)}:density`));
  let removed = 0;
  let added = 0;
  if (bp.density < 0.5) {
    const thin = (0.5 - bp.density) * 2 * DENSITY_THIN_MAX;
    const weak = (n) => n.ticks % ppq !== 0; // 拍の頭ではない
    const drop = (track, isTarget) => {
      const before = track.notes.length;
      track.notes = track.notes.filter((n) => !(isTarget(n) && weak(n) && random() < thin));
      removed += before - track.notes.length;
    };
    if (parts.melody) drop(parts.melody, (n) => n.durationTicks <= ppq / 2); // 8分音符以下の短い音だけ
    for (const track of parts.drums) drop(track, (n) => KICKS_SNARES.includes(n.midi));
  } else if (bp.density > 0.5 && is44) {
    const add = (bp.density - 0.5) * 2 * DENSITY_ADD_MAX;
    const track = maxBy(parts.drums, (t) => t.notes.filter((n) => KICKS_SNARES.includes(n.midi)).length);
    if (track) {
      const step = ppq / 4;
      const used = new Set(track.notes.filter((n) => KICKS_SNARES.includes(n.midi)).map((n) => Math.round(n.ticks / step)));
      const barTicks = ppq * 4;
      const bars = new Set(track.notes.filter((n) => KICKS_SNARES.includes(n.midi)).map((n) => Math.floor(n.ticks / barTicks)));
      for (const bar of [...bars].sort((a, b) => a - b)) {
        for (let i = 0; i < 16; i++) {
          const slot = bar * 16 + i;
          if (i % 4 === 0 || used.has(slot) || random() >= add) continue; // 拍の頭と、もう鳴っている所には足さない
          track.addNote({ midi: GHOST_SNARE, ticks: slot * step, durationTicks: step, velocity: GHOST_VELOCITY });
          added++;
        }
      }
    }
  }
  return { removed, added };
}

// 区間の盛り上がり → 音の強さ。0〜0.5 は 0.65〜1 倍、0.5〜1 は「1 までの残り」の 0〜半分を足す（もとから大きい音も強くなるように）
export function energyVelocity(velocity, energy) {
  const v = energy < 0.5 ? velocity * (ENERGY_VELOCITY_MIN + (1 - ENERGY_VELOCITY_MIN) * energy * 2) : velocity + (1 - velocity) * ENERGY_BOOST_MAX * (energy - 0.5) * 2;
  return clamp(v, 0.05, 1);
}

// 1問ごとの区間の位置（ticks）[{ q, from, to }]
function sectionRanges(layout, barTicks) {
  return Array.from({ length: SECTION_COUNT }, (_, i) => {
    const from = (layout.introBars + i * layout.barsPerQuestion) * barTicks;
    return { q: i + 1, from, to: from + layout.barsPerQuestion * barTicks };
  });
}

// 区間の盛り上がり（4c）と迷い（4d）→ { quiet: [問の番号], pauses: [{ q, beats }] }
function applySections(midi, parts, bp, ranges) {
  const ppq = midi.header.ppq;
  const quiet = [];
  const pauses = [];
  for (const range of ranges) {
    const sec = bp.sections[range.q - 1];
    if (!sec) continue;
    const inside = (n) => n.ticks >= range.from && n.ticks < range.to;
    for (const track of midi.tracks) for (const n of track.notes) if (inside(n)) n.velocity = energyVelocity(n.velocity, sec.energy);
    if (sec.energy < ENERGY_SPARSE) {
      for (const track of parts.drums) track.notes = track.notes.filter((n) => !(inside(n) && DRUM_NOTES.hat.includes(n.midi)));
      quiet.push(range.q);
    }
    // 迷い: 0.25 未満は休まない・0.75 未満は半拍・それ以上は1拍
    const beats = sec.hesitation < 0.25 ? 0 : sec.hesitation < 0.75 ? 0.5 : 1;
    if (beats && parts.melody) {
      const gapEnd = range.from + beats * ppq;
      // 休みの中で始まる音: 休みのあとまで続く音は頭を休みの終わりまで遅らせて残し、休みの中で終わる音は消す
      parts.melody.notes = parts.melody.notes.flatMap((n) => {
        if (n.ticks < range.from || n.ticks >= gapEnd) return [n];
        const end = n.ticks + n.durationTicks;
        if (end <= gapEnd) return [];
        n.durationTicks = end - gapEnd;
        n.ticks = gapEnd;
        return [n];
      });
      parts.melody.notes.sort((a, b) => a.ticks - b.ticks);
      pauses.push({ q: range.q, beats });
    }
  }
  return { quiet, pauses };
}

// テンポの決め方（5・6 と、曲の長さの planLayout が同じ数字を使う）→ { originalBpm, ratio, bpm, drift }
//   originalBpm 原曲の最初のテンポ / ratio 全体に掛ける倍率（叩いた速さ・心拍があるとき）
//   bpm 編集後の最初のテンポ / drift 最後のテンポ ÷ 最初のテンポ（tempoDrift を DRIFT_GAIN 倍にしたもの）
export function tempoPlan(input, midi) {
  const bp = normalizeBlueprint(input);
  const originalBpm = midi.header.tempos[0]?.bpm ?? 120;
  const ratio = bp.sources.taps || bp.sources.heart ? bp.bpm / originalBpm : 1;
  const drift = bp.sources.taps ? round(1 + (bp.tempoDrift - 1) * DRIFT_GAIN, 3) : 1;
  return { originalBpm, ratio, bpm: originalBpm * ratio, drift };
}

// 設計図と MIDI から、編集した MIDI のバイト列まで一度に作る → { midi, bytes, report }
export function editMidiFromBlueprint(source, blueprint, songKey = null, options = {}) {
  const { midi, report } = editMidiByBlueprint(source, blueprint, songKey, options);
  return { midi, bytes: midi.toArray(), report };
}

// ── 音の柔らかさ ─────────────────────────────────

// 音の設定（soundFromBlueprint、src/music/soundSettings.js）→ MIDI の CC の値（0〜1。@tonejs/midi が 0〜127 にする）。数字の出どころを soundFromBlueprint の1か所にするため
function soundToCC(sound) {
  return {
    reverb: sound.reverbWet,
    attack: clamp(sound.padAttack / 2.5, 0, 1),
    release: clamp(sound.padRelease / 5, 0, 1),
    brightness: clamp(Math.log(sound.padFilterHz / 500) / Math.log(8000 / 500), 0, 1),
  };
}

// ── 小さな判定 ──────────────────────────────────
// トラックの見分け（findParts・isDrum）は src/music/parts.js（楽譜の側と共通）

// ゆっくり安定して叩く人は細かく（16分）、バラつきの大きい人は間引く（4分）、それ以外は 8分
function hatDivision(bpm, stability) {
  if (stability < 0.35) return 4;
  if (bpm < 120 && stability >= 0.6) return 16;
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

// melodyRange（0〜1）→ メロディの音域の倍率。真ん中（0.5）でちょうど 1 倍（原曲のまま）になる折れ線
//   0 → RANGE_MIN_FACTOR、0.5 → 1、1 → RANGE_MAX_FACTOR
export function rangeFactorFor(melodyRange) {
  const r = clamp(melodyRange, 0, 1);
  return round(r <= 0.5 ? lerp(RANGE_MIN_FACTOR, 1, r / 0.5) : lerp(1, RANGE_MAX_FACTOR, (r - 0.5) / 0.5));
}
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
