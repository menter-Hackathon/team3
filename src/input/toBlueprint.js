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
//   質問（うごてん）quizToBlueprint(quiz)  10問の答えと回答時間から（性格の点数は scoreQuiz（quiz.js））
//                   baseSong ← 外向性 × 気分の安定（4曲から1曲）・scale ← 外向性と気分の安定の平均（暗い〜明るい）
//                   density ← 外向性と開放性の平均・sections ← 1問ごとの答え（盛り上がり・明るさ）と回答時間（迷い）
//                   10問そろっていなければ使わない（途中でやめたら quiz は null の決まり）。性格の点数は設計図に入れない
//   心拍（任意）    bpm を心拍に寄せる（叩いていなければ心拍の速さにする）
//   顔（任意）      timbre ← face.timbre
//   瞬き（任意）    blinksToBlueprint(blinks, quiz)  瞬きの時刻を「何問目の、答えるまでのどの位置か」（q・at 0〜1）に直す
//                   問いを出した時刻（quiz[i].shownAtMs）と答えるまでの時間（responseMs）で分ける。どの問にも入らない瞬きは使わない
//   最後に必ず normalizeBlueprint() を通す（範囲外の値を直す）
import * as Tone from "tone";
import { NOTES, SCALES, defaultBlueprint, normalizeBlueprint } from "../blueprint.js";
import { clamp, median, round } from "../util.js";
import { analyzeVoice, detectSpeech, trimBuffer } from "./voice.js";
import { analyzeTaps } from "./tap.js";
import { QUESTIONS, CHOICE_WEIGHTS, scoreQuiz } from "./quiz.js";

export async function toBlueprint(materials = {}) {
  const { voiceWav = null, tapIntervalsMs = null, quiz = null, heart = null, face = null, blinks = null } = materials ?? {};
  const bp = defaultBlueprint();
  const sources = { voice: false, taps: false, quiz: false, heart: false, face: false, blinks: false };

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
  const fromQuiz = quizToBlueprint(quiz);
  if (fromQuiz) {
    Object.assign(bp, fromQuiz);
    sources.quiz = true;
  }

  // 瞬き（任意）
  const fromBlinks = blinksToBlueprint(blinks, quiz);
  if (fromBlinks) {
    bp.blinks = fromBlinks;
    sources.blinks = true;
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
// 話し声の抑揚（pitchVariation＝高さの上下の幅 ÷ 1オクターブ）は真ん中に集まりやすいので、この幅を melodyRange 0〜1 に広げる
// （人による違いが曲ではっきり出るように。実際の声を録って調整する前提の目安）
const VARIATION_FLAT = 0.15; // これ以下なら melodyRange 0（抑揚が小さい）
const VARIATION_WIDE = 0.65; // これ以上なら melodyRange 1（抑揚が大きい）
// この幅を breathiness 0〜1 に広げる（実際の声を録って調整する前提の目安）
const CLARITY_CLEAR = 0.95; // これ以上はっきりしていれば breathiness 0
const CLARITY_BREATHY = 0.55; // これ以下なら breathiness 1

// analyzeVoice の結果 → 設計図の一部 { root?, rootFromVoice, melodyRange?, breathiness? }（取れた項目だけ）
export function voiceToBlueprint(features) {
  const root = typeof features?.pitchNote === "string" ? features.pitchNote.replace(/-?\d+$/, "") : null;
  const out = NOTES.includes(root) ? { root, rootFromVoice: true } : { rootFromVoice: false };
  if (!features) return out;
  if (isNum(features.pitchVariation)) out.melodyRange = round(clamp((features.pitchVariation - VARIATION_FLAT) / (VARIATION_WIDE - VARIATION_FLAT), 0, 1));
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

// ── 質問 ───────────────────────────────────────
// 性格 → 音楽の決め方。性格の点数（traits）はこの関数の中だけで使い、設計図には音楽の数字にしてから入れる。
// 「○○タイプ」のような名前は付けない（baseSong は曲の番号だけ）。

// 原曲4曲（public/songs/song1〜4.mid）の割り当て。曲の名前からの仮の割り当てなので、原曲を作ったうごてんが直してよい
//   外向的・気分が安定 → 1「輝く瞬間」、内向的・安定 → 2「Club Ambience」、内向的・揺れやすい → 3「Dramatic Arc」、外向的・揺れやすい → 4「Syncopated Beat」
const SONG_BY_MOOD = { outgoingCalm: 1, quietCalm: 2, quietRestless: 3, outgoingRestless: 4 };
const SCALE_ORDER = Object.keys(SCALES); // 暗い順（phrygian … lydian）
const ENERGY_MIN = 0.25; // 「どちらでもない」と答えた問の盛り上がり。はっきり答えるほど 1 に近づく
const HESITATION_FROM = 1; // 回答時間が自分の中央値より長いぶんを「迷い」にする（ふだんの速さなら 0）
const HESITATION_TO = 2.5; // この倍率で迷い 1
const NEUTRAL_HESITATION = 0.2; // 「どちらでもない」を選んだ問に足す迷い

// 10問の答え [{ value: 1〜5, responseMs }] → 設計図の一部 { baseSong, scale, density, sections } | null（10問そろっていない）
export function quizToBlueprint(quiz) {
  if (!Array.isArray(quiz) || quiz.length !== QUESTIONS.length) return null;
  const traits = scoreQuiz(quiz);
  const calm = 1 - traits.neuroticism; // 気分の安定（神経症傾向の逆）
  const outgoing = traits.extraversion >= 0.5;
  const mood = calm >= 0.5 ? (outgoing ? "outgoingCalm" : "quietCalm") : outgoing ? "outgoingRestless" : "quietRestless";
  const brightness = (traits.extraversion + calm) / 2;

  const times = quiz.map((a) => a?.responseMs).filter((ms) => isNum(ms) && ms > 0);
  const typicalMs = times.length ? median(times) : null;

  return {
    baseSong: SONG_BY_MOOD[mood],
    scale: SCALE_ORDER[Math.round(brightness * (SCALE_ORDER.length - 1))],
    density: round((traits.extraversion + traits.openness) / 2),
    sections: QUESTIONS.map((q, i) => {
      const value = Math.round(quiz[i]?.value);
      const weight = CHOICE_WEIGHTS[value - 1] ?? 0; // -2〜2。範囲外は「どちらでもない」
      // 明るさ：その特性の「明るい側」に答えたら明るく。神経症傾向は高いほうを暗い側にする
      let toward = q.reverse ? -weight : weight;
      if (q.trait === "neuroticism") toward = -toward;
      // 迷い：自分のふだんの速さより時間がかかった問ほど大きく。「どちらでもない」も少し足す
      const ms = quiz[i]?.responseMs;
      const slow = typicalMs && isNum(ms) ? clamp((ms / typicalMs - HESITATION_FROM) / (HESITATION_TO - HESITATION_FROM), 0, 1) : 0;
      return {
        q: i + 1,
        energy: round(ENERGY_MIN + (1 - ENERGY_MIN) * (Math.abs(weight) / 2)),
        brightness: round(0.5 + toward / 4),
        hesitation: round(clamp(slow + (weight === 0 ? NEUTRAL_HESITATION : 0), 0, 1)),
      };
    }),
  };
}

// ── 瞬き ───────────────────────────────────────
// blinks（{ timesMs }。blink.js の tracker.summarize の形）と10問の答え → [{ q, at }] | null（使えない）
// at は「問いを出してから答えるまで」の中の位置（0〜1）。曲では、その問の区間の同じ位置に鳴らす
export function blinksToBlueprint(blinks, quiz) {
  if (!Array.isArray(blinks?.timesMs) || !Array.isArray(quiz) || quiz.length !== QUESTIONS.length) return null;
  const windows = quiz.map((a, i) => ({ q: i + 1, from: a?.shownAtMs, len: a?.responseMs }));
  if (!windows.every((w) => isNum(w.from) && isNum(w.len) && w.len > 0)) return null; // 問いを出した時刻がないと分けられない
  const out = [];
  for (const t of blinks.timesMs) {
    const w = windows.find((x) => t >= x.from && t <= x.from + x.len);
    if (w) out.push({ q: w.q, at: round((t - w.from) / w.len, 3) });
  }
  return out;
}
