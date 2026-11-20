// 【出力・たいが】楽譜 → 音（楽器・音色・エフェクト・音量）。
// 受け渡しの形は docs/interfaces.md の「7. 楽譜」。
//
// scheduleSong(score, assets) → Promise（楽器を作り、楽譜の音をすべて予約する。リバーブの準備ができたら終わる）
//   assets = { voice: AudioBuffer | null }。声を鳴らすかどうかは assets.voice があるかで決める
//   render.js の書き出し用の context（OfflineContext）で呼ばれるので、楽器は最後に toDestination() につなぐだけ
//   楽器は最初の await より前に全部作ること（render.js は、ここまでのあいだだけ書き出し用の context を既定にしている）
//   楽譜の知らないトラックは無視して console.warn を出す
//
// つなぎ方:
//   melody（score.timbre の倍音）・pad（フィルター）→ リバーブ（score.sound）─┐
//   bass・kick・snare・hat ─────────────────────────────┴→ フェード → リミッター（音割れ防止）→ 出力
//   voice → 声用のリバーブ（同じ設定）──────────────────────────────────┘（声はフェードしない）
//   フェード: score.fade { start, end } があれば、その間に音楽の音量を 0 まで下げる（アウトロで音楽が消え、本人の声だけが残る）
//   声の detune（音の高さを変える）はまだ使わない（GrainPlayer で楽器にするのは未定）
import * as Tone from "tone";
import { defaultBlueprint } from "../blueprint.js";
import { soundFromBlueprint } from "./soundSettings.js";

export const KNOWN_TRACKS = ["voice", "pad", "bass", "melody", "kick", "snare", "hat", "blink"];
const DEFAULT_SOUND = soundFromBlueprint(defaultBlueprint()); // 楽譜に sound がないとき
const DEFAULT_TIMBRE = defaultBlueprint().timbre;

// 音量（dB）。楽器ごとのバランス
const VOLUME = { melody: -9, pad: -17, bass: -8, kick: -4, snare: -14, hat: -26, blink: -16, voice: 0 };
const MAX_POLYPHONY = 64; // 同時に鳴らせる音の数（既定の 32 だと、消え方の長いパッドで音が抜けることがある）
const FADE_FLOOR = 0.0001; // フェードの終わりの音量（指数カーブは 0 にできないので、ここまで下げてから 0 にする）
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
  const music = new Tone.Gain(1).connect(limiter); // 音楽全体（フェードをかける）
  const reverb = new Tone.Reverb({ decay: sound.reverbDecay, wet: sound.reverbWet }).connect(music);
  const voiceReverb = new Tone.Reverb({ decay: sound.reverbDecay, wet: sound.reverbWet }).connect(limiter);
  if (score.fade && score.fade.end > score.fade.start) {
    music.gain.setValueAtTime(1, score.fade.start);
    music.gain.exponentialRampToValueAtTime(FADE_FLOOR, score.fade.end);
    music.gain.setValueAtTime(0, score.fade.end);
  }

  // メロディ: 設計図の倍音（顔の輪郭など）をそのまま音色にする
  const melody = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "custom", partials: timbre },
    envelope: { attack: sound.melodyAttack ?? 0.01, decay: 0.2, sustain: 0.6, release: sound.melodyRelease ?? 0.4 },
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
  }).connect(music);

  const kick = new Tone.MembraneSynth({ octaves: 6, pitchDecay: 0.04, volume: VOLUME.kick }).connect(music);
  const snareFilter = new Tone.Filter(1800, "highpass").connect(music);
  const snare = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.15, sustain: 0 }, volume: VOLUME.snare }).connect(snareFilter);
  const hatFilter = new Tone.Filter(8000, "highpass").connect(music);
  const hat = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.04, sustain: 0 }, volume: VOLUME.hat }).connect(hatFilter);

  // 予約（楽譜は同じトラックで同じ time を使わない決まりなので、単音の楽器でもエラーにならない）
  for (const e of tracks.melody ?? []) melody.triggerAttackRelease(e.note, e.duration, e.time, e.velocity);
  for (const e of tracks.pad ?? []) pad.triggerAttackRelease(e.notes, e.duration, e.time, e.velocity);
  for (const e of tracks.bass ?? []) bass.triggerAttackRelease(e.note, e.duration, e.time, e.velocity);
  for (const e of tracks.kick ?? []) kick.triggerAttackRelease("C1", 0.3, e.time, e.velocity);
  for (const e of tracks.snare ?? []) snare.triggerAttackRelease(0.15, e.time, e.velocity);
  for (const e of tracks.hat ?? []) hat.triggerAttackRelease(0.04, e.time, e.velocity);
  // 瞬き：その人が瞬きした位置に、小さな鐘（FM の金属的な音）。リバーブに通して曲になじませる
  if (tracks.blink?.length) {
    const bell = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 3.01,
      modulationIndex: 10,
      envelope: { attack: 0.001, decay: 0.6, sustain: 0, release: 0.8 },
      modulationEnvelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.3 },
      volume: VOLUME.blink,
    }).connect(reverb);
    for (const e of tracks.blink) bell.triggerAttackRelease(e.note, 0.3, e.time, e.velocity);
  }

  // 声: イントロとアウトロで本人の声をそのまま流す（duration がなければ最後まで。ただし MAX_VOICE_SEC 秒まで）
  if (assets?.voice) {
    const voiceGain = new Tone.Gain(Tone.dbToGain(VOLUME.voice)).connect(voiceReverb);
    for (const e of tracks.voice ?? []) {
      const player = new Tone.Player(assets.voice).connect(voiceGain);
      player.start(e.time, 0, e.duration ?? Math.min(assets.voice.duration, MAX_VOICE_SEC));
    }
  }

  await Promise.all([reverb.ready, voiceReverb.ready]); // リバーブの響きを作り終わるまで待つ（待たないと最初の音に響きが付かない）
}
