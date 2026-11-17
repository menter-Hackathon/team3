// 【入力1】画面を叩いたリズム → 速さ（BPM）・ズレ（groove）・安定度（stability）。
import { clamp, median } from "../util.js";

const MIN_BPM = 60;
const MAX_BPM = 160;
const GROOVE_LIMIT = 0.05; // groove は ±50ms まで
const OUTLIER_BEATS = 0.3; // 拍の位置から 0.3 拍以上はずれた叩きは、叩き損じ・裏拍として推定から外す
const STABILITY_SCALE = 0.15; // 拍のバラつきがこの割合（拍の長さに対して）以上なら安定度 0

// tapTimesMs: 叩いた時刻（ミリ秒、performance.now()）の配列。少なすぎるときは null
// → { bpm, groove: [4拍分の秒], stability: 0〜1（叩くたびのバラつきの小ささ）, count }
export function analyzeTaps(tapTimesMs) {
  const times = tapTimesMs;
  if (!times || times.length < 4) return null;

  const intervals = times
    .slice(1)
    .map((t, i) => t - times[i])
    .filter((ms) => ms > 150 && ms < 2000);
  if (intervals.length < 3) return null;

  // 速さのおおよその値: 間隔の中央値。60〜160 BPM に収まるよう倍・半分にする
  const roughBeatMs = 60000 / foldBpm(60000 / median(intervals));

  // 拍の格子 t = a + b×k を、全部の叩きに当てはめて決める（最初の1回に頼らない）
  const t0 = times[0];
  const rel = times.map((t) => t - t0);
  const { a, b, ks, used } = fitGrid(rel, roughBeatMs);
  const bpm = Math.round(foldBpm(60000 / b));

  // ズレ: 4拍のうち何拍目かごとに、格子からのズレの中央値（叩き損じに引っ張られない）
  const residuals = rel.map((t, i) => t - (a + b * ks[i])); // ミリ秒
  const byPos = [[], [], [], []];
  rel.forEach((_, i) => {
    if (used[i]) byPos[((ks[i] % 4) + 4) % 4].push(residuals[i]);
  });
  const grooveMs = byPos.map((list) => (list.length ? median(list) : 0));
  const groove = grooveMs.map((ms) => clamp(ms / 1000, -GROOVE_LIMIT, GROOVE_LIMIT));

  // 安定度: ズレのクセ（groove）を除いたあとの、叩くたびのバラつき。毎回同じ位置なら 1、バラバラなら 0
  const devs = [];
  rel.forEach((_, i) => {
    if (used[i]) devs.push(Math.abs(residuals[i] - grooveMs[((ks[i] % 4) + 4) % 4]));
  });
  const spread = (1.4826 * median(devs)) / b; // 拍の長さに対する割合（頑健な標準偏差）
  const stability = clamp(1 - spread / STABILITY_SCALE, 0, 1);

  return { bpm, groove, stability, count: times.length };
}

function foldBpm(bpm) {
  while (bpm < MIN_BPM) bpm *= 2;
  while (bpm > MAX_BPM) bpm /= 2;
  return bpm;
}

// 叩きの時刻（最初を 0 にしたもの）に拍の格子 t = a + b×k を当てはめる。
// 「どの拍に当たるか（k）を決める → 最小二乗で a, b を決め直す」を数回くり返す。
function fitGrid(rel, roughBeatMs) {
  let a = 0;
  let b = roughBeatMs;
  let ks = assignBeats(rel, a, b, true);

  for (let round = 0; round < 4; round++) {
    let used = pickUsed(rel, ks, a, b);
    const fit = leastSquares(rel.filter((_, i) => used[i]), ks.filter((_, i) => used[i]));
    if (!fit) break;
    a = fit.a;
    b = fit.b;
    // 当てはめた結果が範囲外にずれたら（速さの倍・半分の取り違え）、範囲内に戻して続ける
    b = 60000 / foldBpm(60000 / b);
    ks = assignBeats(rel, a, b, false);
  }
  return { a, b, ks, used: pickUsed(rel, ks, a, b) };
}

// 各叩きがどの拍（整数 k）に当たるか。
// 最初の1回は直前の叩きからの間隔で順に数える（テンポが少し変わっても数えまちがえにくい）。
// 2回目以降は、今の格子から一番近い拍にする。
function assignBeats(rel, a, b, sequential) {
  if (!sequential) return rel.map((t) => Math.round((t - a) / b));
  const ks = [0];
  for (let i = 1; i < rel.length; i++) ks.push(ks[i - 1] + Math.round((rel[i] - rel[i - 1]) / b));
  return ks;
}

// 拍の位置から大きくはずれた叩きを除く。除きすぎて4つ未満になるときは全部使う。
function pickUsed(rel, ks, a, b) {
  const used = rel.map((t, i) => Math.abs(t - (a + b * ks[i])) <= OUTLIER_BEATS * b);
  return used.filter(Boolean).length >= 4 ? used : rel.map(() => true);
}

// t ≈ a + b×k の最小二乗。k が全部同じ値なら null。
function leastSquares(ts, ks) {
  const n = ts.length;
  let sk = 0, st = 0, skk = 0, skt = 0;
  for (let i = 0; i < n; i++) {
    sk += ks[i];
    st += ts[i];
    skk += ks[i] * ks[i];
    skt += ks[i] * ts[i];
  }
  const denom = n * skk - sk * sk;
  if (denom === 0) return null;
  const b = (n * skt - sk * st) / denom;
  if (!(b > 0)) return null;
  return { a: (st - b * sk) / n, b };
}
