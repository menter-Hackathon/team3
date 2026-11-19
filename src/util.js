// みんなで使う小さな関数。

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// 小数第2位までに丸める（表示・設計図の数字をそろえる）
export function round(value, digits = 2) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

// 種から作る乱数（mulberry32）。同じ種なら同じ並びになる（同じ設計図からは同じ曲にするため。Math.random は使わない）
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 文字列 → 種（FNV-1a）。例: seededRandom(hashString(JSON.stringify(blueprint)))
export function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
