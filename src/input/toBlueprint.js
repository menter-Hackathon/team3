// 【入力1】集めた材料 → 曲の設計図。設計図のまとめ役。
//
// 書くもの:
//   toBlueprint({ voice, taps, quiz, heart, face }) → 設計図（形は src/blueprint.js）
//     どの材料も null のことがある。足りない所は defaultBlueprint() の値のままにする
//
// 参考:
//   const bp = defaultBlueprint();
//   if (taps) { bp.bpm = taps.bpm; bp.groove = taps.groove; }
//   if (heart) bp.bpm = (bp.bpm + heart.bpm) / 2;   // 心拍があれば寄せる
//   if (quiz) { const p = scoreQuiz(quiz); bp.scale = …; bp.root = …; bp.density = …; bp.sections = … }
//   bp.voice = Boolean(voice);
//   if (face) bp.timbre = face.timbre;
//   return normalizeBlueprint(bp);                  // 最後に必ず通す（範囲外の値を直す）
//   性格 → 音階・主音などの対応は、曲1と相談して決める
import { defaultBlueprint, normalizeBlueprint } from "../blueprint.js";

export function toBlueprint(materials = {}) {
  // TODO(入力1)
  return normalizeBlueprint(defaultBlueprint());
}
