// 【出力】材料 → 曲の設計図と声の音。声・叩く＝たいが、質問＝うごてん（心拍・顔は任意。取れたときだけ使う）。
// 受け渡しの形は docs/interfaces.md の「4. 材料」「5. 設計図」。
//
// 書くもの:
//   toBlueprint({ voiceWav, tapIntervalsMs, quiz, heart, face }) → Promise<{ blueprint, assets }>（例外を投げない）
//     どの材料も null のことがある。足りない所は defaultBlueprint() の値のままにする
//     assets = { voice: AudioBuffer | null }（voiceWav を読み込み、前後の無音を切ったもの。曲の最初と最後に流す）
//
// 参考:
//   const bp = defaultBlueprint();
//   声（たいが）:   voiceWav を AudioBuffer に読み込む → analyzeVoice(buffer)（voice.js）
//                   → bp.root（pitchNote）・bp.melodyRange（pitchVariation）・bp.breathiness（clarity の逆）
//   叩く（たいが）: tapIntervalsMs → 時刻の配列にして analyzeTaps（tap.js）
//                   → bp.bpm・bp.groove・bp.stability・bp.tempoDrift（前半と後半の間隔の比）
//   質問（うごてん）: const traits = scoreQuiz(quiz) → bp.baseSong・bp.scale・bp.density・bp.sections
//   心拍（任意）:   if (heart) bp.bpm = (bp.bpm + heart.bpm) / 2;    // 心拍があれば寄せる
//   顔（任意）:     if (face) bp.timbre = face.timbre;
//   bp.sources = { voice: !!voiceWav, taps: !!tapIntervalsMs, quiz: !!quiz, heart: !!heart, face: !!face };
//   return { blueprint: normalizeBlueprint(bp), assets };    // 最後に必ず通す（範囲外の値を直す）
//   性格 → 音楽の決め方（baseSong・scale・density・sections）は、うごてんが決める
import { defaultBlueprint, normalizeBlueprint } from "../blueprint.js";

export async function toBlueprint(materials = {}) {
  // TODO(出力: 声・叩く＝たいが、質問＝うごてん)
  return { blueprint: normalizeBlueprint(defaultBlueprint()), assets: { voice: null } };
}
