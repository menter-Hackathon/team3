// 【曲1】設計図 → 楽譜（いつ・どの楽器で・どの音を鳴らすか）。ここではまだ音を鳴らさない。
// 構成: イントロ2小節（声）→ 1問ごとに2小節 × 10 → アウトロ2小節（声）
// 同じ設計図からは毎回同じ曲ができる（乱数の種を設計図から作る）。
import { NOTES, SCALES, normalizeBlueprint } from "../blueprint.js";

export const INTRO_BARS = 2;
export const BARS_PER_SECTION = 2;
export const OUTRO_BARS = 2;
const TAIL_SECONDS = 2; // 最後の音の余韻
const PROGRESSION = [0, 5, 3, 4]; // 音階の何番目から和音を作るか（I → vi → IV → V）

// 返す楽譜: { bpm, duration（秒）, timbre, tracks: { 楽器名: [{ time（秒）, ... }] } }
// 各トラックの音は時間順に並べる（曲2の予約がこの順番を前提にしている）
export function compose(input) {
  const bp = normalizeBlueprint(input);
  const beat = 60 / bp.bpm;
  const bar = beat * 4;
  const random = seededRandom(JSON.stringify(bp));
  const scale = SCALES[bp.scale];
  const rootMidi = 48 + NOTES.indexOf(bp.root); // 主音を C3〜B3 に置く

  // 音階の degree 番目（7 で1オクターブ上）の音名
  const note = (degree, octave = 0) => {
    const d = ((degree % 7) + 7) % 7;
    const o = Math.floor(degree / 7) + octave;
    return midiToNote(rootMidi + scale[d] + 12 * o);
  };
  // barIndex 小節目の beatInBar 拍目の時刻（叩き方のズレを足す）
  const at = (barIndex, beatInBar) =>
    Math.max(0, barIndex * bar + beatInBar * beat + bp.groove[Math.floor(beatInBar) % 4]);

  const tracks = { voice: [], pad: [], bass: [], melody: [], kick: [], snare: [], hat: [] };
  const sectionBars = bp.sections.length * BARS_PER_SECTION;
  const totalBars = INTRO_BARS + sectionBars + OUTRO_BARS;

  if (bp.voice) {
    tracks.voice.push({ time: 0 });
    tracks.voice.push({ time: (INTRO_BARS + sectionBars) * bar });
  }

  let melodyDegree = 4;
  for (let b = 0; b < totalBars; b++) {
    const inSections = b >= INTRO_BARS && b < INTRO_BARS + sectionBars;
    const section = inSections ? bp.sections[Math.floor((b - INTRO_BARS) / BARS_PER_SECTION)] : null;
    const energy = section?.energy ?? 0.2;
    const degree = PROGRESSION[b % PROGRESSION.length];

    // 和音: 全小節
    tracks.pad.push({
      time: at(b, 0),
      notes: [note(degree, 1), note(degree + 2, 1), note(degree + 4, 1)],
      duration: bar * 0.95,
      velocity: 0.3 + 0.3 * energy,
    });
    if (!section) continue; // イントロ・アウトロは和音と声だけ

    // ベース: 1拍目と3拍目
    for (const beatInBar of [0, 2]) {
      tracks.bass.push({ time: at(b, beatInBar), note: note(degree, -1), duration: beat * 1.5, velocity: 0.7 });
    }

    // リズム: 盛り上がるほど増える
    for (let step = 0; step < 8; step++) {
      const beatInBar = step / 2;
      if (energy > 0.2 && (step === 0 || step === 4)) tracks.kick.push({ time: at(b, beatInBar), velocity: 0.9 });
      if (energy > 0.5 && (step === 2 || step === 6)) tracks.snare.push({ time: at(b, beatInBar), velocity: 0.6 });
      if (energy > 0.35) tracks.hat.push({ time: at(b, beatInBar), velocity: step % 2 ? 0.3 : 0.5 });
    }

    // メロディ: 8分音符ごとに鳴らすか決める。音の多さ × 盛り上がり、迷った問は少なめ
    const chance = bp.density * (0.3 + 0.7 * energy) * (1 - 0.6 * section.hesitation);
    const octave = section.brightness > 0.6 ? 2 : 1;
    for (let step = 0; step < 8; step++) {
      if (random() > chance) continue;
      melodyDegree = Math.min(9, Math.max(0, melodyDegree + [-2, -1, 1, 2][Math.floor(random() * 4)]));
      tracks.melody.push({
        time: at(b, step / 2),
        note: note(melodyDegree, octave),
        duration: beat * 0.45,
        velocity: 0.5 + 0.4 * energy,
      });
    }
  }

  return { bpm: bp.bpm, duration: totalBars * bar + TAIL_SECONDS, timbre: bp.timbre, tracks };
}

function midiToNote(midi) {
  return `${NOTES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

// 文字列から作る、毎回同じ並びになる乱数（0〜1）
function seededRandom(text) {
  let seed = 2166136261;
  for (let i = 0; i < text.length; i++) seed = Math.imul(seed ^ text.charCodeAt(i), 16777619);
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
