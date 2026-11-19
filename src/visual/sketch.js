// 【映像】（担当なし・手が空いた人）設計図や曲に合わせて絵を描く。
// 受け渡しの形は docs/interfaces.md の「8. 出力」。
//
// 書くもの:
//   drawVisual(container, { blueprint, score, audio }) → { remove() }（p5 のインスタンスでよい）
//     audio は再生中の <audio>。audio.currentTime と score.structure で、曲の今どこかが分かる
//
// 参考（p5 のインスタンスモード。p5 は大きいので、使うときだけ読み込む）:
//   const { default: p5 } = await import("p5");
//   return new p5((p) => {
//     p.setup = () => p.createCanvas(container.clientWidth, 200);
//     p.draw = () => { p.background(20); /* blueprint.sections や audio.currentTime を使って描く */ };
//   }, container);

export async function drawVisual(container, { blueprint, score, audio }) {
  // TODO(映像)
  return { remove() {} };
}
