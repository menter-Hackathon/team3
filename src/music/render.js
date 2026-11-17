// 【曲2】楽譜 → 音声ファイル（WAV の Blob）。
// Tone.Offline で、曲の長さを待たずに一気に書き出す。画面ではこの WAV を再生するので、
// 聞いた曲と持ち帰る曲は同じものになる。
import * as Tone from "tone";
import { scheduleSong } from "./sound.js";
import { audioBufferToWav } from "./wav.js";

export async function renderSong(score, assets = {}) {
  const rendered = await Tone.Offline(() => {
    scheduleSong(score, assets);
  }, score.duration, 2, 44100);
  return audioBufferToWav(rendered.get());
}
