// 【曲2】楽譜 → 音（楽器・音色・エフェクト・音量）。
//
// 書くもの:
//   scheduleSong(score, assets) 楽器を作り、楽譜の音をすべて予約する
//     assets.voice は録音した声（AudioBuffer）。なければ undefined
//     render.js の Tone.Offline の中で呼ばれるので、楽器は toDestination() につなぐだけでよい
//
// 参考（import * as Tone from "tone"）:
//   const synth = new Tone.PolySynth(Tone.Synth, {
//     oscillator: { type: "custom", partials: score.timbre }, // 設計図の倍音をそのまま音色にする
//   }).toDestination();
//   for (const e of score.tracks.pad) synth.triggerAttackRelease(e.notes, e.duration, e.time, e.velocity);
//   声を楽器に: const grain = new Tone.GrainPlayer(assets.voice).toDestination();
//              grain.detune（セント）や grain.playbackRate で変え、grain.start(time) で鳴らす
//   音割れを防ぐ: 楽器 → new Tone.Limiter(-1) → toDestination() の順につなぐ
//   注意: 同じ楽器を同じ時刻に2回鳴らすとエラーになることがある

export function scheduleSong(score, assets = {}) {
  // TODO(曲2)
}
