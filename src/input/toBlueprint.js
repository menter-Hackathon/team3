// 【入力1】集めた材料 → 曲の設計図。設計図のまとめ役。
// どの材料が null でも設計図は作れるようにする（足りない所は既定値）。
// 今の対応づけは仮。曲1と相談して決める。
import { defaultBlueprint, normalizeBlueprint, NOTES, SCALES } from "../blueprint.js";
import { clamp } from "../util.js";
import { QUESTIONS, scoreQuiz } from "./quiz.js";

// voice: recordVoice() の結果 / taps: analyzeTaps() の結果 / quiz: 10問の答え
// heart: { bpm } / face: { timbre }
export function toBlueprint({ voice = null, taps = null, quiz = null, heart = null, face = null } = {}) {
  const bp = defaultBlueprint();

  // 速さ: 叩いた速さ。心拍があれば心拍に寄せる
  const tapBpm = taps?.bpm ?? null;
  const heartBpm = heart?.bpm ?? null;
  if (tapBpm && heartBpm) bp.bpm = (tapBpm + heartBpm) / 2;
  else bp.bpm = tapBpm ?? heartBpm ?? bp.bpm;
  if (taps) bp.groove = taps.groove;

  if (quiz) {
    const p = scoreQuiz(quiz);
    // 音階: 外向的で落ち着いているほど明るい音階（仮）
    const scaleNames = Object.keys(SCALES);
    const brightness = (p.extraversion + (1 - p.neuroticism)) / 2;
    bp.scale = scaleNames[Math.round(brightness * (scaleNames.length - 1))];
    // 主音: 開放性から（仮）。TODO: 声の高さから決める案もある
    bp.root = NOTES[Math.round(p.openness * 11)];
    // 音の多さ: 外向性から（仮）
    bp.density = 0.3 + 0.6 * p.extraversion;
    bp.sections = quiz.map((answer, i) => sectionFromAnswer(answer, QUESTIONS[i]));
  }

  bp.voice = Boolean(voice);
  if (face?.timbre) bp.timbre = face.timbre;

  return normalizeBlueprint(bp);
}

// 1問の答え → その問の区間（2小節）の盛り上がり・明るさ・迷い
function sectionFromAnswer(answer, question) {
  const value = answer?.value ?? 4;
  const traitValue = question?.reverse ? 8 - value : value;
  return {
    energy: Math.abs(value - 4) / 3, // はっきり答えたほど盛り上がる
    brightness: (traitValue - 1) / 6, // その特性に寄っているほど明るい（仮）
    hesitation: clamp(((answer?.ms ?? 0) - 2000) / 8000, 0, 1), // 2秒を超えて迷ったぶん
  };
}
