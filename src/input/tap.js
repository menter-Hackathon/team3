// 【入力1】画面を叩いたリズム → 速さ（BPM）とズレ（groove）。
//
// 書くもの:
//   analyzeTaps(times) → { bpm, groove: [4拍ぶんの秒], count }、少なすぎるときは null
//     times は叩いた時刻（ミリ秒）の配列。画面側（main.js）で pointerdown のたびに performance.now() を入れる
//
// 参考:
//   速さ: 隣どうしの間隔の中央値 → bpm = 60000 / 間隔。60〜160 に収まるよう倍・半分にする
//   ズレ: 1拍の長さで区切った「ちょうどの位置」から何秒ずれたかを、4拍のうち何拍目かごとに平均する
//         （設計図の groove は ±0.05 秒まで）

export function analyzeTaps(times) {
  // TODO(入力1)
  return null;
}
