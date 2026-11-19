// 【出力・うごてん】曲の長さ：テンポに合わせて、イントロ・1問・アウトロの小節の数を決める（約1分）。
// ここでは音を鳴らさない・ブラウザの機能を使わない（Node でも動く）。受け渡しの形は docs/interfaces.md の「6. 原曲」「7. 楽譜」。
//
// planLayout(bpm, drift, maxBars) → { introBars, barsPerQuestion, outroBars, totalBars, estimatedSec }
//   bpm      曲の最初のテンポ（tempoPlan の bpm。叩いた速さなど）
//   drift    最後のテンポ ÷ 最初のテンポ（tempoPlan の drift。1小節ごとに少しずつ変わる）
//   maxBars  原曲の小節の数（これを超える組み合わせは選ばない）
//   イントロ 2〜4小節・1問 1〜4小節 × 10・アウトロ 2〜6小節の中から、長さが TARGET_SEC に一番近いものを選ぶ。
//   同じくらい近ければ、イントロ・アウトロが短いもの（2小節）を選ぶ。
//   アウトロ（音楽がフェードアウトする所）は 4〜10 秒、イントロ（声が流れる所）は 5〜12 秒になるようにする
//   （イントロが短すぎると、本人の声が1問目の音楽にかぶるため）
//   （遅い曲で長すぎるフェード・速い曲で急に切れるフェードにならないように）
//   例（テンポの変化なし）: 60 BPM → 15小節（60秒）、80 → 17（51秒）、90 → 24（64秒）、120 → 29（58秒）、160 → 40（60秒）。テンポとテンポの変化によって約50〜70秒（多くは55〜66秒）
// trimToBars(midi, bars) → 頭から bars 小節だけにした MIDI のコピー（はみ出す音は区間の終わりで切る）
// DEFAULT_LAYOUT          今までの決まり（2小節ずつ・24小節）。layout を渡さないときに midiToScore が使う
import { SECTION_COUNT } from "../../blueprint.js";

export const TARGET_SEC = 60;
const INTRO_BARS = [2, 3, 4];
const QUESTION_BARS = [1, 2, 3, 4];
const OUTRO_BARS = [2, 3, 4, 5, 6]; // アウトロは音楽がフェードアウトする所なので、少し長くてもよい
const EXTRA_BAR_PENALTY_SEC = 0.5; // イントロ・アウトロを1小節伸ばすのは、長さが 0.5 秒以上近づくときだけ
const FADE_MIN_SEC = 4;
const FADE_MAX_SEC = 10;
const INTRO_MIN_SEC = 5;
const INTRO_MAX_SEC = 12;
const OUT_OF_RANGE_PENALTY = 3; // フェード・イントロの長さが範囲から 1 秒外れるごとに、長さが 3 秒ずれたのと同じだけ避ける

export const DEFAULT_LAYOUT = layoutOf(2, 2, 2);

export function planLayout(bpm, drift = 1, maxBars = Infinity) {
  let best = null;
  for (const intro of INTRO_BARS) {
    for (const perQ of QUESTION_BARS) {
      for (const outro of OUTRO_BARS) {
        const layout = layoutOf(intro, perQ, outro);
        if (layout.totalBars > maxBars) continue;
        const sec = barsSeconds(layout.totalBars, bpm, drift);
        const introSec = barsSeconds(layout.totalBars, bpm, drift, 0, intro);
        const fadeSec = barsSeconds(layout.totalBars, bpm, drift, layout.totalBars - outro, layout.totalBars);
        const outOfRange = Math.max(0, FADE_MIN_SEC - fadeSec) + Math.max(0, fadeSec - FADE_MAX_SEC) + Math.max(0, INTRO_MIN_SEC - introSec) + Math.max(0, introSec - INTRO_MAX_SEC);
        const cost = Math.abs(sec - TARGET_SEC) + EXTRA_BAR_PENALTY_SEC * (intro - 2 + outro - 2) + OUT_OF_RANGE_PENALTY * outOfRange;
        if (!best || cost < best.cost) best = { ...layout, estimatedSec: Math.round(sec * 10) / 10, cost };
      }
    }
  }
  if (!best) {
    // 原曲が一番短い組み合わせ（14小節）より短い: 1問1小節にして、そのまま使う（midiToScore が警告を出す）
    const layout = layoutOf(2, 1, 2);
    return { ...layout, estimatedSec: Math.round(barsSeconds(layout.totalBars, bpm, drift) * 10) / 10 };
  }
  const { cost, ...layout } = best;
  return layout;
}

// bars 小節の曲のうち、from〜to 小節目の長さ（秒。省くと全体）。
// テンポは1小節ごとに 1 → drift 倍へ少しずつ変わる（blueprintEdit.js のテンポの変化と同じ）
export function barsSeconds(bars, bpm, drift = 1, from = 0, to = bars) {
  let sec = 0;
  for (let i = from; i < to; i++) {
    const ramp = bars < 2 ? 1 : 1 + ((drift - 1) * i) / (bars - 1);
    sec += 240 / (bpm * ramp);
  }
  return sec;
}

export function trimToBars(source, bars) {
  const midi = source.clone();
  const limit = bars * midi.header.ppq * 4;
  for (const track of midi.tracks) {
    track.notes = track.notes.filter((n) => n.ticks < limit);
    for (const n of track.notes) if (n.ticks + n.durationTicks > limit) n.durationTicks = limit - n.ticks;
    for (const number of Object.keys(track.controlChanges)) {
      track.controlChanges[number] = track.controlChanges[number].filter((cc) => cc.ticks < limit);
    }
  }
  midi.header.tempos = midi.header.tempos.filter((t) => t.ticks < limit);
  midi.header.update();
  return midi;
}

function layoutOf(introBars, barsPerQuestion, outroBars) {
  return { introBars, barsPerQuestion, outroBars, totalBars: introBars + barsPerQuestion * SECTION_COUNT + outroBars };
}
