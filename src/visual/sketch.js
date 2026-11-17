// 【映像】（担当なし・手が空いた人）設計図や音から絵を描く。
//
// 書くもの:
//   drawVisual(container, blueprint) → p5 のインスタンス（消すときは .remove()）
//
// 参考（p5 のインスタンスモード。p5 は大きいので、使うときだけ読み込む）:
//   const { default: p5 } = await import("p5");
//   return new p5((p) => {
//     p.setup = () => p.createCanvas(container.clientWidth, 200);
//     p.draw = () => { p.background(20); /* blueprint.sections などを使って描く */ };
//   }, container);
//   音に合わせて動かすなら、Tone.Meter や Tone.FFT の値を draw の中で読む

export async function drawVisual(container, blueprint) {
  // TODO(映像)
  return null;
}
