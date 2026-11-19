// 【出力・たいが】楽譜 → 音（楽器・音色・エフェクト・音量）。
// 受け渡しの形は docs/interfaces.md の「7. 楽譜」。
//
// scheduleSong(score, assets) → Promise（楽器を作り、楽譜の音をすべて予約する。リバーブの準備ができたら終わる）
//   assets = { voice: AudioBuffer | null }。声を鳴らすかどうかは assets.voice があるかで決める
//   render.js の Tone.Offline の中で呼ばれるので、楽器は最後に toDestination() につなぐだけ
//   楽譜の知らないトラックは無視して console.warn を出す
//
// つなぎ方:
//   melody（score.timbre の倍音）・pad（フィルター）・voice ─→ リバーブ（score.sound）─┐
//   bass・kick・snare・hat ──────────────────────────────────┴→ リミッター（音割れ防止）→ 出力
//   声の detune（音の高さを変える）はまだ使わない（GrainPlayer で楽器にするのは未定）
import * as Tone from "tone";
import { defaultBlueprint } from "../blueprint.js";
import { soundFromBlueprint } from "./soundSettings.js";

const KNOWN_TRACKS = ["voice", "pad", "bass", "melody", "kick", "snare", "hat"];
const DEFAULT_SOUND = soundFromBlueprint(defaultBlueprint()); // 楽譜に sound がないとき
const DEFAULT_TIMBRE = defaultBlueprint().timbre;

// 音量（dB）。楽器ごとのバランス
const VOLUME = { melody: -9, pad: -17, bass: -8, kick: -4, snare: -14, hat: -26, voice: 0 };
const MAX_POLYPHONY = 64; // 同時に鳴らせる音の数（既定の 32 だと、消え方の長いパッドで音が抜けることがある）
export const MAX_VOICE_SEC = 10; // 声を流す最大の長さ（秒）。長すぎる録音が曲の中ずっと鳴らないように

export async function scheduleSong(score, assets = { voice: null }) {
  const sound = { ...DEFAULT_SOUND, ...(score.sound ?? {}) };
  const timbre = Array.isArray(score.timbre) && score.timbre.length ? score.timbre : DEFAULT_TIMBRE;
  const tracks = score.tracks ?? {};
  for (const name of Object.keys(tracks)) {
    if (!KNOWN_TRACKS.includes(name)) console.warn(`楽譜の知らないトラック「${name}」は鳴らしません`);
  }

  // 出力のつなぎ方
  const limiter = new Tone.Limiter(-1).toDestination();
  const reverb = new Tone.Reverb({ decay: sound.reverbDecay, wet: sound.reverbWet }).connect(limiter);

  // メロディ: 設計図の倍音（顔の輪郭など）をそのまま音色にする
  const melody = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "custom", partials: timbre },
    envelope: { attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.4 },
    volume: VOLUME.melody,
  }).connect(reverb);
  melody.maxPolyphony = MAX_POLYPHONY;

  // パッド: 息っぽい声ほど、ゆっくり立ち上がり、長く残り、こもった音にする
  const padFilter = new Tone.Filter(sound.padFilterHz, "lowpass").connect(reverb);
  const pad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "fatsawtooth", count: 3, spread: 20 },
    envelope: { attack: sound.padAttack, decay: 0.3, sustain: 0.8, release: sound.padRelease },
    volume: VOLUME.pad,
  }).connect(padFilter);
  pad.maxPolyphony = MAX_POLYPHONY;

  const bass = new Tone.MonoSynth({
    oscillator: { type: "triangle" },
    filter: { type: "lowpass", Q: 1 },
    filterEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.4, baseFrequency: 200, octaves: 2 },
    envelope: { attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.3 },
    volume: VOLUME.bass,
  }).connect(limiter);

  const kick = new Tone.MembraneSynth({ octaves: 6, pitchDecay: 0.04, volume: VOLUME.kick }).connect(limiter);
  const snareFilter = new Tone.Filter(1800, "highpass").connect(limiter);
  const snare = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.15, sustain: 0 }, volume: VOLUME.snare }).connect(snareFilter);
  const hatFilter = new Tone.Filter(8000, "highpass").connect(limiter);
  const hat = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.04, sustain: 0 }, volume: VOLUME.hat }).connect(hatFilter);

  // 予約（楽譜は同じトラックで同じ time を使わない決まりなので、単音の楽器でもエラーにならない）
  for (const e of tracks.melody ?? []) melody.triggerAttackRelease(e.note, e.duration, e.time, e.velocity);
  for (const e of tracks.pad ?? []) pad.triggerAttackRelease(e.notes, e.duration, e.time, e.velocity);
  for (const e of tracks.bass ?? []) bass.triggerAttackRelease(e.note, e.duration, e.time, e.velocity);
  for (const e of tracks.kick ?? []) kick.triggerAttackRelease("C1", 0.3, e.time, e.velocity);
  for (const e of tracks.snare ?? []) snare.triggerAttackRelease(0.15, e.time, e.velocity);
  for (const e of tracks.hat ?? []) hat.triggerAttackRelease(0.04, e.time, e.velocity);

  // 声: イントロとアウトロで本人の声をそのまま流す（duration がなければ最後まで。ただし MAX_VOICE_SEC 秒まで）
  if (assets?.voice) {
    const voiceGain = new Tone.Gain(Tone.dbToGain(VOLUME.voice)).connect(reverb);
    for (const e of tracks.voice ?? []) {
      const player = new Tone.Player(assets.voice).connect(voiceGain);
      player.start(e.time, 0, e.duration ?? Math.min(assets.voice.duration, MAX_VOICE_SEC));
    }
  }

  await reverb.ready; // リバーブの響きを作り終わるまで待つ（待たないと最初の音に響きが付かない）
}
