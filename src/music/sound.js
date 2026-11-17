// 【曲2】楽譜 → 音（楽器・音色・エフェクト・音量）。
// 今のコンテキスト（Tone.Offline の中なら書き出し用）に楽器を作り、楽譜の音をすべて予約する。
import * as Tone from "tone";

// assets.voice: 録音した声（AudioBuffer）。なければ声なし
export function scheduleSong(score, assets = {}) {
  const master = new Tone.Limiter(-1).toDestination();
  const reverb = new Tone.Freeverb({ roomSize: 0.8, wet: 0.25 }).connect(master);

  // 和音とメロディの音色は、設計図の timbre（倍音の強さ）からそのまま作る
  const pad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "custom", partials: score.timbre },
    envelope: { attack: 0.4, decay: 0.2, sustain: 0.6, release: 1.5 },
    volume: -18,
  }).connect(reverb);
  const lead = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "custom", partials: score.timbre },
    envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.4 },
    volume: -14,
  }).connect(reverb);
  const bass = new Tone.MonoSynth({
    oscillator: { type: "triangle" },
    envelope: { attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.3 },
    volume: -10,
  }).connect(master);
  const kick = new Tone.MembraneSynth({ volume: -8 }).connect(master);
  const snare = new Tone.NoiseSynth({
    envelope: { attack: 0.001, decay: 0.15, sustain: 0 },
    volume: -18,
  }).connect(reverb);
  const hat = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.05, release: 0.01 },
    volume: -34,
  }).connect(master);

  const { tracks } = score;
  for (const e of tracks.pad) pad.triggerAttackRelease(e.notes, e.duration, e.time, e.velocity);
  for (const e of tracks.melody) lead.triggerAttackRelease(e.note, e.duration, e.time, e.velocity);
  for (const e of tracks.bass) bass.triggerAttackRelease(e.note, e.duration, e.time, e.velocity);
  for (const e of tracks.kick) kick.triggerAttackRelease("C1", "8n", e.time, e.velocity);
  for (const e of tracks.snare) snare.triggerAttackRelease("16n", e.time, e.velocity);
  for (const e of tracks.hat) hat.triggerAttackRelease("C6", "32n", e.time, e.velocity);

  // 声: 今はイントロとアウトロでそのまま鳴らすだけ
  // TODO(曲2): Tone.GrainPlayer で声を楽器にして、曲の中でも使う
  if (assets.voice) {
    const voice = new Tone.Player(assets.voice).connect(master);
    for (const e of tracks.voice) voice.start(e.time);
  }
}
