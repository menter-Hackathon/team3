// 【出力・たいが】楽譜 → 音声ファイル（WAV の Blob）。
// 受け渡しの形は docs/interfaces.md の「7. 楽譜」「8. 出力」。
//
// renderSong(score, assets) → Promise<Blob>（audio/wav、44.1kHz・16bit・ステレオ）
//   曲が作れないときは例外を投げる（UI がエラー画面を出す）
//   Tone.Offline で、曲の長さを待たずに一気に書き出す（Tone.start() は要らない）
//   画面ではこの WAV を <audio> で流すと、「聞いた曲」と「持ち帰る曲」が同じになる
import * as Tone from "tone";
import { scheduleSong } from "./sound.js";
import { audioBufferToWav } from "./wav.js";

export const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const MAX_DURATION = 180; // 秒。楽譜がおかしくて長すぎるときに止める

export async function renderSong(score, assets = { voice: null }) {
  if (!score || !score.tracks) throw new Error("楽譜がありません");
  if (!(score.duration > 0) || score.duration > MAX_DURATION) throw new Error(`曲の長さがおかしいです（${score.duration} 秒）`);
  const rendered = await Tone.Offline(async () => {
    await scheduleSong(score, assets);
  }, score.duration, CHANNELS, SAMPLE_RATE);
  const buffer = rendered.get();
  normalizePeak(buffer);
  return audioBufferToWav(buffer);
}

// 一番大きい音が −1 dB（0.89）になるように、曲全体の音量をそろえる。
// リミッターだけでは一瞬の大きな音が 1 を超えて音割れすることがあるため。小さすぎる曲は最大 4 倍まで上げる
const PEAK_TARGET = 0.89;
const MAX_GAIN = 4;

export function normalizePeak(buffer) {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  let peak = 0;
  for (const data of channels) for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  if (peak === 0) return 1;
  const gain = Math.min(MAX_GAIN, PEAK_TARGET / peak);
  for (const data of channels) for (let i = 0; i < data.length; i++) data[i] *= gain;
  return gain;
}
