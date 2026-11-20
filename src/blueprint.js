// 曲の設計図。出力の中で、材料から作り（toBlueprint）、原曲の選択と MIDI の編集に使う（compose）。
// 各項目の意味と範囲は docs/interfaces.md の「5. 設計図」。
// 項目を足す・変えるときは docs/interfaces.md の「11. 形を変えるとき」に従う。
import { clamp } from "./util.js";

export const BLUEPRINT_VERSION = 1;
export const SECTION_COUNT = 10;
const MAX_BLINKS = 60; // 設計図に入れる瞬きの数の上限（1分の曲に鳴らしすぎないように）
export const SOURCE_NAMES = ["voice", "taps", "quiz", "heart", "face", "blinks"]; // 材料の名前（sources のキー）
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
    baseSong: 1, // 原曲4曲のどれか（1〜4）
    bpm: 90,
    root: "C",
    rootFromVoice: false, // root を声の高さから決めたか（false なら原曲のキーのまま）
    scale: "dorian",
    density: 0.5,
    groove: [0, 0, 0, 0], // 4拍それぞれのズレ（秒、各 ±0.05）。曲では 2 倍にして入れる（blueprintEdit.js）
    melodyRange: 0.5, // メロディの音域（0〜1。声の抑揚）。0.5 で原曲のまま
    breathiness: 0.3, // 息っぽさ（0〜1。リバーブ・パッドの柔らかさ）
    stability: 0.5, // 叩くたびのバラつきの小ささ（0〜1。ドラムの細かさ・揺らぎ）
    tempoDrift: 1, // 最後のテンポ ÷ 最初のテンポ（0.9〜1.1）。曲では変化を 2.5 倍にして使う（blueprintEdit.js）
    timbre: [1, 0.5, 0.3, 0.15],
    sections: Array.from({ length: SECTION_COUNT }, (_, i) => ({
      q: i + 1,
      energy: 0.5,
      brightness: 0.5,
      hesitation: 0,
    })),
    blinks: [], // 瞬きした位置 [{ q: 1〜10, at: その問の中の位置 0〜1 }]。曲ではその問の区間の同じ位置に小さな鐘を鳴らす
    sources: Object.fromEntries(SOURCE_NAMES.map((name) => [name, false])),
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
    baseSong: Math.round(num(input.baseSong, base.baseSong, 1, 4)),
    bpm: Math.round(num(input.bpm, base.bpm, 60, 160)),
    root: NOTES.includes(input.root) ? input.root : base.root,
    rootFromVoice: Boolean(input.rootFromVoice),
    scale: input.scale in SCALES ? input.scale : base.scale,
    density: num(input.density, base.density, 0, 1),
    groove: base.groove.map((d, i) => num(input.groove?.[i], d, -0.05, 0.05)),
    melodyRange: num(input.melodyRange, base.melodyRange, 0, 1),
    breathiness: num(input.breathiness, base.breathiness, 0, 1),
    stability: num(input.stability, base.stability, 0, 1),
    tempoDrift: num(input.tempoDrift, base.tempoDrift, 0.9, 1.1),
    timbre: timbre.slice(0, 16).map((v) => num(v, 0, 0, 1)),
    // 10個に満たないときは既定の区間で埋める
    sections: Array.from({ length: SECTION_COUNT }, (_, i) => ({
      q: i + 1,
      energy: num(sections[i]?.energy, 0.5, 0, 1),
      brightness: num(sections[i]?.brightness, 0.5, 0, 1),
      hesitation: num(sections[i]?.hesitation, 0, 0, 1),
    })),
    blinks: (Array.isArray(input.blinks) ? input.blinks : [])
      .filter((b) => Number.isInteger(b?.q) && b.q >= 1 && b.q <= SECTION_COUNT && Number.isFinite(b?.at))
      .slice(0, MAX_BLINKS)
      .map((b) => ({ q: b.q, at: num(b.at, 0, 0, 1) })),
    sources: Object.fromEntries(SOURCE_NAMES.map((name) => [name, Boolean(input.sources?.[name])])),
  };
}

// 開発用の見本。入力がなくても曲側の作業を進められるように。
export const SAMPLE_BLUEPRINT = normalizeBlueprint({
  baseSong: 2,
  bpm: 78,
  root: "D",
  rootFromVoice: true,
  scale: "dorian",
  density: 0.7,
  groove: [0, 0.03, -0.02, 0.05],
  melodyRange: 0.6,
  breathiness: 0.3,
  stability: 0.8,
  tempoDrift: 1.05,
  timbre: [1, 0.4, 0.25, 0.1],
  sections: [0.3, 0.8, 0.5, 0.9, 0.2, 0.6, 0.7, 0.4, 1.0, 0.5].map((energy, i) => ({
    energy,
    brightness: (i % 3) / 2,
    hesitation: i === 4 ? 0.8 : 0.1,
  })),
});
