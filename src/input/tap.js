// 【入力1】画面を叩いたリズム → 速さ（BPM）とズレ（groove）。
// 受け渡しの形は docs/interfaces.md の「4. 材料」。
//
// 書くもの:
//   analyzeTaps(tapTimesMs) → { bpm: 60〜160 の整数, groove: [秒 × 4]（各 ±0.05）, count: 叩いた回数 } | null
//     tapTimesMs は叩いた時刻（performance.now() のミリ秒）の配列。UI が pointerdown のたびに集める
//     4回未満など、少なすぎて分からないときは null
//
// 参考:
//   速さ: 隣どうしの間隔の中央値 → bpm = 60000 / 間隔。60〜160 に収まるよう倍・半分にする
//   ズレ: 1拍の長さで区切った「ちょうどの位置」から何秒ずれたかを、4拍のうち何拍目かごとに平均する

export function analyzeTaps(tapTimesMs) {
  // TODO(入力1)
  return null;
}
