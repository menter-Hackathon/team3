// 【入力1】画面を叩いたリズム → 速さ（BPM）とズレ（groove）。
import { clamp, median } from "../util.js";

// times: 叩いた時刻（ミリ秒、performance.now()）の配列。少なすぎるときは null
export function analyzeTaps(times) {
  if (!times || times.length < 4) return null;

  const intervals = times
    .slice(1)
    .map((t, i) => t - times[i])
    .filter((ms) => ms > 150 && ms < 2000);
  if (intervals.length < 3) return null;

  // 速さ: 間隔の中央値。60〜160 BPM に収まるよう倍・半分にする
  let bpm = 60000 / median(intervals);
  while (bpm < 60) bpm *= 2;
  while (bpm > 160) bpm /= 2;
  const beatMs = 60000 / bpm;

  // ズレ: 4拍のうち何拍目かごとに、ちょうどの位置から平均して何秒前後にずれたか
  const sums = [0, 0, 0, 0];
  const counts = [0, 0, 0, 0];
  for (const t of times) {
    const k = Math.round((t - times[0]) / beatMs);
    const pos = ((k % 4) + 4) % 4;
    sums[pos] += (t - (times[0] + k * beatMs)) / 1000;
    counts[pos] += 1;
  }
  const groove = sums.map((sum, i) => (counts[i] ? clamp(sum / counts[i], -0.05, 0.05) : 0));

  return { bpm: Math.round(bpm), groove, count: times.length };
}
