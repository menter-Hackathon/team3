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
//   melody（score.timbre の倍音 → ビブラート）・pad（フィルター → コーラス）→ リバーブ（score.sound）─┐
//   bass・kick・snare（胴＋ノイズ）・hat（ノイズの高い所、少し右）────────────────────┴→ フェード → コンプレッサー（まとめる）→ リミッター（音割れ防止）→ 出力
//   voice → 声用のリバーブ（同じ設定）──────────────────────────────────┘（声はフェードしない）
//   区間の明るさ: score.sections の brightness で、メロディとパッドのローパスの周波数を区間ごとに 0.5〜2 倍にする（0.5 で変えない）
//     区間の頭から SECTION_RAMP（1）秒かけて変える。区間の外（イントロ・アウトロ）は 1 倍。sections の時刻は負でもよい（render.js の部分の前に始まった区間）
//   フェード: score.fade { start, end } があれば、その間に音楽の音量を 0 まで下げる（アウトロで音楽が消え、本人の声だけが残る）
//   声の detune（音の高さを変える）はまだ使わない（GrainPlayer で楽器にするのは未定）
import * as Tone from "tone";
import { defaultBlueprint } from "../blueprint.js";
import { soundFromBlueprint } from "./soundSettings.js";

export const KNOWN_TRACKS = ["voice", "pad", "bass", "melody", "kick", "snare", "hat", "blink"];
const DEFAULT_SOUND = soundFromBlueprint(defaultBlueprint()); // 楽譜に sound がないとき
const DEFAULT_TIMBRE = defaultBlueprint().timbre;

// 音量（dB）。楽器ごとのバランス
const VOLUME = { melody: -9, pad: -17, bass: -8, kick: -4, snareBody: -10, snare: -12, hat: -9, blink: -16, voice: 0 };
const MAX_POLYPHONY = 64; // 同時に鳴らせる音の数（既定の 32 だと、消え方の長いパッドで音が抜けることがある）
const MELODY_FILTER_HZ = 6000; // メロディのローパスの基準（区間の明るさで 3000〜12000 Hz）
const SECTION_RAMP = 1; // 秒。区間の明るさを変えるのにかける時間（短いと急に変わって聞こえる）
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
  const glue = new Tone.Compressor({ threshold: -18, ratio: 3, attack: 0.01, release: 0.2 }).connect(limiter); // 楽器どうしをまとめる
  const music = new Tone.Gain(1).connect(glue); // 音楽全体（フェードをかける）
  const reverb = new Tone.Reverb({ decay: sound.reverbDecay, wet: sound.reverbWet }).connect(music);
  const voiceReverb = new Tone.Reverb({ decay: sound.reverbDecay, wet: sound.reverbWet }).connect(limiter);
  if (score.fade && score.fade.end > score.fade.start) {
    music.gain.setValueAtTime(1, score.fade.start);
    music.gain.exponentialRampToValueAtTime(FADE_FLOOR, score.fade.end);
    music.gain.setValueAtTime(0, score.fade.end);
  }

  // メロディ: 設計図の倍音（顔の輪郭など）をそのまま音色にする。区間（10問）があるときだけ、明るさをローパスで変える
  const hasSections = Array.isArray(score.sections) && score.sections.length > 0;
  const vibrato = new Tone.Vibrato({ frequency: 4.5, depth: 0.04 }).connect(reverb); // 少しだけ揺らして、機械っぽさを減らす
  const melodyFilter = hasSections ? new Tone.Filter(MELODY_FILTER_HZ, "lowpass").connect(vibrato) : null;
  const melody = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "custom", partials: timbre },
    envelope: { attack: sound.melodyAttack ?? 0.01, decay: 0.2, sustain: 0.6, release: sound.melodyRelease ?? 0.4 },
    volume: VOLUME.melody,
  }).connect(melodyFilter ?? vibrato);
  melody.maxPolyphony = MAX_POLYPHONY;

  // パッド: 息っぽい声ほど、ゆっくり立ち上がり、長く残り、こもった音にする
  const padChorus = new Tone.Chorus({ frequency: 0.8, delayTime: 3.5, depth: 0.6, wet: 0.5 }).connect(reverb).start(); // 左右に広げる
  const padFilter = new Tone.Filter(sound.padFilterHz, "lowpass").connect(padChorus);
  const pad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "fatsawtooth", count: 3, spread: 20 },
    envelope: { attack: sound.padAttack, decay: 0.3, sustain: 0.8, release: sound.padRelease },
    volume: VOLUME.pad,
  }).connect(padFilter);
  pad.maxPolyphony = MAX_POLYPHONY;

  if (hasSections) {
    scheduleBrightness(melodyFilter.frequency, MELODY_FILTER_HZ, score.sections);
    scheduleBrightness(padFilter.frequency, sound.padFilterHz, score.sections);
  }

  const bass = new Tone.MonoSynth({
    oscillator: { type: "triangle" },
    filter: { type: "lowpass", Q: 1 },
    filterEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.4, baseFrequency: 200, octaves: 2 },
    envelope: { attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.3 },
    volume: VOLUME.bass,
  }).connect(music);

  const kick = new Tone.MembraneSynth({
    octaves: 6,
    pitchDecay: 0.04,
    envelope: { attack: 0.001, decay: 0.35, sustain: 0, release: 0.4 },
    volume: VOLUME.kick,
  }).connect(music);
  // スネア: 胴の鳴り（短い太鼓の音）とノイズ（響き線）を重ねる
  const snareBody = new Tone.MembraneSynth({ octaves: 2, pitchDecay: 0.02, envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.05 }, volume: VOLUME.snareBody }).connect(music);
  const snareFilter = new Tone.Filter(1500, "highpass").connect(music);
  const snare = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.18, sustain: 0 }, volume: VOLUME.snare }).connect(snareFilter);
  // ハイハット: ノイズの高い所に山（バンドパス）を作って、シャリッとした金属っぽい音にする。少し右に置いて広がりを出す
  // （MetalSynth のほうが本物らしいが、発振器が鳴りっぱなしで書き出しが倍近く遅くなるので使わない）
  const hatPan = new Tone.Panner(0.25).connect(music);
  const hatHighpass = new Tone.Filter(7000, "highpass").connect(hatPan);
  const hatTone = new Tone.Filter({ type: "bandpass", frequency: 10000, Q: 0.8 }).connect(hatHighpass);
  const hat = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.05, sustain: 0 }, volume: VOLUME.hat }).connect(hatTone);

  // 予約（楽譜は同じトラックで同じ time を使わない決まりなので、単音の楽器でもエラーにならない）
  for (const e of tracks.melody ?? []) melody.triggerAttackRelease(e.note, e.duration, e.time, e.velocity);
  for (const e of tracks.pad ?? []) pad.triggerAttackRelease(e.notes, e.duration, e.time, e.velocity);
  for (const e of tracks.bass ?? []) bass.triggerAttackRelease(e.note, e.duration, e.time, e.velocity);
  for (const e of tracks.kick ?? []) kick.triggerAttackRelease("C1", 0.3, e.time, e.velocity);
  for (const e of tracks.snare ?? []) {
    snareBody.triggerAttackRelease("G2", 0.1, e.time, e.velocity);
    snare.triggerAttackRelease(0.15, e.time, e.velocity);
  }
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

// 区間の明るさ（0〜1）→ 周波数の倍率（0 → 0.5 倍・0.5 → 1 倍・1 → 2 倍）
export function brightnessFactor(brightness) {
  return Math.pow(2, (brightness - 0.5) * 2);
}

// 区間ごとにフィルターの周波数を変える。時刻 0 より前に始まった区間は、0 の時点の値として入れる
function scheduleBrightness(param, baseHz, sections = []) {
  if (!sections?.length) return;
  const hz = (factor) => Math.min(18000, Math.max(100, baseHz * factor));
  const steps = [];
  const sorted = [...sections].sort((a, b) => a.start - b.start);
  sorted.forEach((s, i) => {
    steps.push({ time: s.start, factor: brightnessFactor(s.brightness) });
    // 次の区間がすぐ続くときは 1 倍に戻さない（戻すと、次の区間の値へ一気に飛ぶため）
    const next = sorted[i + 1];
    if (!next || next.start - s.end > 1e-6) steps.push({ time: s.end, factor: 1 });
  });
  const current = steps.filter((x) => x.time <= 0).at(-1);
  param.setValueAtTime(hz(current?.factor ?? 1), 0);
  let last = current?.factor ?? 1;
  for (const step of steps.filter((x) => x.time > 0)) {
    if (step.factor === last) continue;
    param.setValueAtTime(hz(last), step.time);
    param.exponentialRampToValueAtTime(hz(step.factor), step.time + SECTION_RAMP);
    last = step.factor;
  }
}
