// 【出力・たいが】楽譜 → 音（楽器・音色・エフェクト・音量）。
// 受け渡しの形は docs/interfaces.md の「7. 楽譜」。
//
// 書くもの:
//   scheduleSong(score, assets) 楽器を作り、楽譜の音をすべて予約する（戻り値なし）
//     assets = { voice: AudioBuffer | null }。声を鳴らすかどうかは assets.voice があるかで決める
//     render.js の Tone.Offline の中で呼ばれるので、楽器は toDestination() につなぐだけでよい
//     楽譜の知らないトラックは無視して console.warn を出す
//
// 参考（import * as Tone from "tone"）:
//   const synth = new Tone.PolySynth(Tone.Synth, {
//     oscillator: { type: "custom", partials: score.timbre }, // 設計図の倍音をそのまま音色にする
//   }).toDestination();
//   for (const e of score.tracks.pad) synth.triggerAttackRelease(e.notes, e.duration, e.time, e.velocity);
//   声を楽器に: const grain = new Tone.GrainPlayer(assets.voice).toDestination();
//              voice の音ごとに grain.detune（セント）を変え、grain.start(e.time) で鳴らす
//   音割れを防ぐ: 楽器 → new Tone.Limiter(-1) → toDestination() の順につなぐ
//   注意: 同じ楽器を同じ時刻に2回鳴らすとエラーになることがある

export function scheduleSong(score, assets = { voice: null }) {
  // TODO(出力・たいが)
}
