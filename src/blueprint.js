// 曲の設計図。入力（input/・sensor/）と曲（music/）の受け渡しはこれだけ。
// 項目を足す・変えるときは change/ ブランチで、入力と曲の担当に相談してから。
// 各項目の意味は docs/PRODUCT.md の「曲の設計図」。
import { clamp } from "./util.js";

export const BLUEPRINT_VERSION = 1;
export const SECTION_COUNT = 10;
export const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// 音階。暗い → 明るい の順に並べてある
export const SCALES = {
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  lydian: [0, 2, 4, 6, 7, 9, 11],
};

export function defaultBlueprint() {
  return {
    version: BLUEPRINT_VERSION,
    bpm: 90,
    root: "C",
    scale: "dorian",
    density: 0.5,
    groove: [0, 0, 0, 0],
    voice: false,
    timbre: [1, 0.5, 0.3, 0.15],
    sections: Array.from({ length: SECTION_COUNT }, (_, i) => ({
      q: i + 1,
      energy: 0.5,
      brightness: 0.5,
      hesitation: 0,
    })),
  };
}

// 足りない項目を既定値で埋め、範囲外の数字を丸める。曲側は必ずこれを通してから使う。
export function normalizeBlueprint(input = {}) {
  const base = defaultBlueprint();
  const num = (value, fallback, min, max) =>
    typeof value === "number" && Number.isFinite(value) ? clamp(value, min, max) : fallback;

  const sections = Array.isArray(input.sections) && input.sections.length ? input.sections : base.sections;
  const timbre = Array.isArray(input.timbre) && input.timbre.length ? input.timbre : base.timbre;

  return {
    version: BLUEPRINT_VERSION,
    bpm: Math.round(num(input.bpm, base.bpm, 60, 160)),
    root: NOTES.includes(input.root) ? input.root : base.root,
    scale: input.scale in SCALES ? input.scale : base.scale,
    density: num(input.density, base.density, 0, 1),
    groove: base.groove.map((d, i) => num(input.groove?.[i], d, -0.05, 0.05)),
    voice: Boolean(input.voice),
    timbre: timbre.slice(0, 16).map((v) => num(v, 0, 0, 1)),
    sections: sections.slice(0, SECTION_COUNT).map((s, i) => ({
      q: i + 1,
      energy: num(s?.energy, 0.5, 0, 1),
      brightness: num(s?.brightness, 0.5, 0, 1),
      hesitation: num(s?.hesitation, 0, 0, 1),
    })),
  };
}

// 開発用の見本。入力がなくても曲側の作業を進められるように。
export const SAMPLE_BLUEPRINT = normalizeBlueprint({
  bpm: 78,
  root: "D",
  scale: "dorian",
  density: 0.7,
  groove: [0, 0.03, -0.02, 0.05],
  timbre: [1, 0.4, 0.25, 0.1],
  sections: [0.3, 0.8, 0.5, 0.9, 0.2, 0.6, 0.7, 0.4, 1.0, 0.5].map((energy, i) => ({
    energy,
    brightness: (i % 3) / 2,
    hesitation: i === 4 ? 0.8 : 0.1,
  })),
});
