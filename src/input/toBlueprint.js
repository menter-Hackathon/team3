// 【出力】材料 → 曲の設計図と声の音。声・叩く＝たいが、質問＝うごてん（心拍・顔は任意。取れたときだけ使う）。
// 受け渡しの形は docs/interfaces.md の「4. 材料」「5. 設計図」。
//
// toBlueprint({ voiceWav, tapIntervalsMs, quiz, heart, face }) → Promise<{ blueprint, assets }>（例外を投げない）
//   どの材料も null のことがある。足りない所は defaultBlueprint() の値のまま
//   assets = { voice: AudioBuffer | null }（voiceWav を読み込み、前後の無音を切ったもの。曲の最初と最後に流す）
//
// 材料 → 設計図の決め方:
//   声（たいが）    voiceToBlueprint(features)  analyzeVoice（voice.js）の結果から
//                   root ← pitchNote（声の高さの音名）・melodyRange ← pitchVariation（抑揚）・breathiness ← clarity（澄み具合）の逆
//                   声が録れていれば sources.voice は true。声の高さが取れなかったとき（ささやき声など）は
//                   root を入れず rootFromVoice を false にする（原曲のキーのまま）。取れた項目だけ入れる
//   叩く（たいが）  tapsToBlueprint(intervalsMs) 叩いた間隔 → 時刻にして analyzeTaps（tap.js）
//                   bpm・groove・stability ← analyzeTaps の結果、tempoDrift ← 前半と後半の拍の長さの比
//   質問（うごてん）baseSong・scale・density・sections ← scoreQuiz（quiz.js）。TODO(うごてん)
//   心拍（任意）    bpm を心拍に寄せる（叩いていなければ心拍の速さにする）
//   顔（任意）      timbre ← face.timbre
//   最後に必ず normalizeBlueprint() を通す（範囲外の値を直す）
import * as Tone from "tone";
import { NOTES, defaultBlueprint, normalizeBlueprint } from "../blueprint.js";
import { clamp, median, round } from "../util.js";
import { analyzeVoice, detectSpeech, trimBuffer } from "./voice.js";
import { analyzeTaps } from "./tap.js";

export async function toBlueprint(materials = {}) {
  const { voiceWav = null, tapIntervalsMs = null, quiz = null, heart = null, face = null } = materials ?? {};
  const bp = defaultBlueprint();
  const sources = { voice: false, taps: false, quiz: false, heart: false, face: false };

  // 声
  const voice = await loadVoice(voiceWav);
  if (voice) {
    Object.assign(bp, voiceToBlueprint(voice.features));
    sources.voice = true;
  }

  // 叩く
  const fromTaps = tapsToBlueprint(tapIntervalsMs);
  if (fromTaps) {
    Object.assign(bp, fromTaps);
    sources.taps = true;
  }

  // 心拍（任意）
  if (heart && Number.isFinite(heart.bpm) && heart.bpm > 0) {
    bp.bpm = sources.taps ? (bp.bpm + heart.bpm) / 2 : heart.bpm;
    sources.heart = true;
  }

  // 顔（任意）
  if (face && Array.isArray(face.timbre) && face.timbre.length) {
    bp.timbre = face.timbre;
    sources.face = true;
  }

  // 質問（うごてん）
  if (Array.isArray(quiz) && quiz.length) {
    // TODO(うごてん): const traits = scoreQuiz(quiz) → bp.baseSong・bp.scale・bp.density・bp.sections
    sources.quiz = true;
  }

  bp.sources = sources;
  return { blueprint: normalizeBlueprint(bp), assets: { voice: voice?.buffer ?? null } };
}

// ── 声 ────────────────────────────────────────

// 声の WAV（Blob）→ { buffer: 前後の無音を切った AudioBuffer, features } | null（声が入っていない・読めない）
export async function loadVoice(voiceWav) {
  if (!voiceWav) return null;
  try {
    const raw = await Tone.getContext().decodeAudioData(await voiceWav.arrayBuffer());
    const speech = detectSpeech(raw.getChannelData(0), raw.sampleRate);
    if (!speech) return null;
    const features = analyzeVoice(raw, speech);
    const { buffer } = trimBuffer(raw, speech);
    return { buffer, features };
  } catch (error) {
    console.warn("声の WAV を読み込めませんでした", error);
    return null;
  }
}

// clarity（澄み具合）は声の高さが取れた所だけの平均なので、実際は 0.5〜1 くらいしか動かない。
// この幅を breathiness 0〜1 に広げる（実際の声を録って調整する前提の目安）
const CLARITY_CLEAR = 0.95; // これ以上はっきりしていれば breathiness 0
const CLARITY_BREATHY = 0.55; // これ以下なら breathiness 1

// analyzeVoice の結果 → 設計図の一部 { root?, rootFromVoice, melodyRange?, breathiness? }（取れた項目だけ）
export function voiceToBlueprint(features) {
  const root = typeof features?.pitchNote === "string" ? features.pitchNote.replace(/-?\d+$/, "") : null;
  const out = NOTES.includes(root) ? { root, rootFromVoice: true } : { rootFromVoice: false };
  if (!features) return out;
  if (isNum(features.pitchVariation)) out.melodyRange = round(clamp(features.pitchVariation, 0, 1));
  if (isNum(features.clarity)) out.breathiness = round(clamp((CLARITY_CLEAR - features.clarity) / (CLARITY_CLEAR - CLARITY_BREATHY), 0, 1));
  return out;
}

// ── 叩く ───────────────────────────────────────

const MIN_INTERVAL_MS = 150; // analyzeTaps と同じ。これより短い・長い間隔は叩き損じとして外す
const MAX_INTERVAL_MS = 2000;
const MIN_DRIFT_INTERVALS = 6; // テンポの変化を見るのに必要な間隔の数
const DRIFT_MIN = 0.9; // テンポの変化は ±10% まで
const DRIFT_MAX = 1.1;
const DRIFT_IGNORE = 0.02; // ±2% 未満の変化は「変化なし」
const BEAT_TOLERANCE = Math.log2(1.15); // 0.5・1・2 拍から ±15% 以内の間隔だけ使う（1.5 拍などの付点は使わない）

// 叩いた間隔（ミリ秒の配列）→ 設計図の一部 { bpm, groove, stability, tempoDrift } | null（少なすぎる）
export function tapsToBlueprint(intervalsMs) {
  if (!Array.isArray(intervalsMs)) return null;
  const intervals = intervalsMs.filter((ms) => Number.isFinite(ms) && ms > 0);
  const times = [0];
  for (const ms of intervals) times.push(times.at(-1) + ms);
  const taps = analyzeTaps(times);
  if (!taps) return null;
  return {
    bpm: taps.bpm,
    groove: taps.groove.map((sec) => round(sec, 3)),
    stability: round(taps.stability),
    tempoDrift: tempoDrift(intervals, taps.bpm),
  };
}

// 前半と後半の「拍の長さ」を比べる。後半が短い（速くなった）なら 1 より大きい。
// 途中で 4分音符 → 8分音符 のように叩き方を細かくしても速くなったと間違えないように、
// 間隔を拍の長さにそろえて（半分の間隔は 2 倍、倍の間隔は半分にして）から比べる。
// 付点・シンコペーション（1.5 拍・0.75 拍など）の間隔は、拍の長さに直せないので比べる対象から外す
export function tempoDrift(intervals, bpm) {
  const beatMs = 60000 / bpm;
  const beats = intervals
    .filter((ms) => ms > MIN_INTERVAL_MS && ms < MAX_INTERVAL_MS)
    .filter((ms) => {
      const octaves = Math.log2(ms / beatMs);
      return Math.abs(octaves - Math.round(octaves)) < BEAT_TOLERANCE;
    })
    .map((ms) => ms / 2 ** Math.round(Math.log2(ms / beatMs)));
  if (beats.length < MIN_DRIFT_INTERVALS) return 1;
  const half = Math.floor(beats.length / 2);
  const ratio = median(beats.slice(0, half)) / median(beats.slice(beats.length - half));
  if (Math.abs(ratio - 1) < DRIFT_IGNORE) return 1;
  return round(clamp(ratio, DRIFT_MIN, DRIFT_MAX));
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
