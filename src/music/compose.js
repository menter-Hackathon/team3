// 【曲1】設計図 → 楽譜（いつ・どの楽器で・どの音を鳴らすか）。ここではまだ音を鳴らさない。
//
// 書くもの:
//   compose(blueprint) → 楽譜 { bpm, duration（秒）, timbre, tracks: { 楽器名: [音, …] } }
//     音の例: { time: 1.5（秒）, note: "D4", duration: 0.4, velocity: 0.8 }
//     和音なら notes: ["D4", "F4", "A4"]
//     各トラックの音は時間順に並べる（曲2の予約が時間順を前提にする）
//
// 決まっていること（docs/PRODUCT.md）:
//   構成はイントロ2小節（声）→ 1問＝2小節 × 10 → アウトロ2小節（声）
//   同じ設計図からは同じ曲にする（Math.random ではなく、設計図から種を作った乱数を使う）
//
// 参考:
//   const bp = normalizeBlueprint(blueprint);
//   const beat = 60 / bp.bpm;              // 1拍の秒数。1小節は beat * 4
//   音階: SCALES[bp.scale] は主音から何半音上かの並び。主音は NOTES.indexOf(bp.root)
//   ノリ: 拍の時刻に bp.groove[4拍のうち何拍目か] を足すと、その人の叩き方のズレが出る
//   盛り上がり: bp.sections[i].energy で音数やドラムを増やす、brightness で音域を上げる、など
//   入力ができる前は、SAMPLE_BLUEPRINT（src/blueprint.js）で試せる
import { normalizeBlueprint } from "../blueprint.js";

export function compose(blueprint) {
  const bp = normalizeBlueprint(blueprint);
  // TODO(曲1)
  return { bpm: bp.bpm, duration: 0, timbre: bp.timbre, tracks: {} };
}
