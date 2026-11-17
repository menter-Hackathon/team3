// 【映像】（担当なし・手が空いた人）設計図から絵を描く。今は10問ぶんの盛り上がりを並べるだけ。
// p5 は大きいので、使うときだけ読み込む。
export async function drawVisual(container, blueprint) {
  const { default: p5 } = await import("p5");
  return new p5((p) => {
    p.setup = () => {
      p.createCanvas(container.clientWidth || 320, 160);
      p.noLoop();
    };
    p.draw = () => {
      p.background(20);
      p.noStroke();
      const w = p.width / blueprint.sections.length;
      blueprint.sections.forEach((s, i) => {
        p.fill(80 + 175 * s.brightness, 120, 255 - 120 * s.brightness);
        const h = 20 + (p.height - 30) * s.energy;
        p.rect(i * w + 4, p.height - h, w - 8, h, 4);
      });
    };
  }, container);
}
