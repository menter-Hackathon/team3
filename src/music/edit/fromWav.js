// 【声の担当】入力担当からもらう声の WAV と原曲の MIDI から、編集した MIDI を作る（ブラウザ用）。
// 声は個人情報なので、ブラウザの中だけで使い、保存・送信しない。
//
// editMidiFromWav(wav, midiData, songKey?) → { midi, bytes, features, params, report }
//   wav      声の WAV（Blob / File / ArrayBuffer / AudioBuffer）。null なら声なし（原曲のキー・音域のまま）
//   midiData 原曲の MIDI（ArrayBuffer / Uint8Array）か、@tonejs/midi の Midi
//   songKey  { root, scale }（原曲のキーが分かっていれば。省くと推定）
//   midi     編集した Midi、bytes はその .mid ファイルの中身（Uint8Array）
//   params.sound に、鳴らすときのリバーブ・パッドの設定が入っている
import * as Tone from "tone";
import { Midi } from "@tonejs/midi";
import { analyzeVoice } from "../../input/voice.js";
import { voiceToParams, editMidiByVoice } from "./voiceEdit.js";

export async function editMidiFromWav(wav, midiData, songKey = null) {
  const features = await analyzeWav(wav);
  const params = voiceToParams(features);
  const source = midiData instanceof Midi ? midiData : new Midi(midiData);
  const { midi, report } = editMidiByVoice(source, params, songKey);
  return { midi, bytes: midi.toArray(), features, params, report };
}

// WAV → 声の特徴（入力1の analyzeVoice をそのまま使う）。読めない・声がないときは null
export async function analyzeWav(wav) {
  if (!wav) return null;
  try {
    const buffer = wav instanceof AudioBuffer ? wav : await decodeWav(wav);
    const features = analyzeVoice(buffer);
    return features.pitchHz === null && features.loudness === 0 ? null : features;
  } catch (error) {
    console.warn("声の WAV を読めませんでした", error);
    return null;
  }
}

async function decodeWav(wav) {
  const data = wav instanceof ArrayBuffer ? wav : await wav.arrayBuffer();
  return Tone.getContext().decodeAudioData(data.slice(0)); // decode は中身を使い切るのでコピーを渡す
}
