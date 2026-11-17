// 【入力1】集めた材料 → 曲の設計図。設計図のまとめ役。
// 受け渡しの形は docs/interfaces.md の「4. 材料」「5. 設計図」。
//
// 書くもの:
//   toBlueprint({ voice, taps, quiz, heart, face }) → 設計図（例外を投げない）
//     どの材料も null のことがある。足りない所は defaultBlueprint() の値のままにする
//
// 参考:
//   const bp = defaultBlueprint();
//   if (taps) { bp.bpm = taps.bpm; bp.groove = taps.groove; }
//   if (heart) bp.bpm = (bp.bpm + heart.bpm) / 2;    // 心拍があれば寄せる
//   if (quiz) { const traits = scoreQuiz(quiz); bp.scale = …; bp.root = …; bp.density = …; bp.sections = … }
//   if (face) bp.timbre = face.timbre;
//   bp.sources = { voice: !!voice, taps: !!taps, quiz: !!quiz, heart: !!heart, face: !!face };
//   return normalizeBlueprint(bp);                   // 最後に必ず通す（範囲外の値を直す）
//   性格 → 音楽の決め方（scale・root・density・sections）は、入力1と曲1の2人で決める
import { defaultBlueprint, normalizeBlueprint } from "../blueprint.js";

export function toBlueprint(materials = {}) {
  // TODO(入力1)
  return normalizeBlueprint(defaultBlueprint());
}
