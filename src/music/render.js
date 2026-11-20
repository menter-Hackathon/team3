// 【出力・たいが】楽譜 → 音声ファイル（WAV の Blob）。
// 受け渡しの形は docs/interfaces.md の「7. 楽譜」「8. 出力」。
//
// renderSong(score, assets) → Promise<Blob>（audio/wav、44.1kHz・16bit・ステレオ）
//   曲が作れないときは例外を投げる（UI がエラー画面を出す）
//   Tone.Offline で、曲の長さを待たずに一気に書き出す（Tone.start() は要らない）
//   長さは score.duration。声（duration なし＝最後まで）がそれより長く続くときは、声の終わり + 声のリバーブの余韻まで伸ばす
//   画面ではこの WAV を <audio> で流すと、「聞いた曲」と「持ち帰る曲」が同じになる
import * as Tone from "tone";
import { scheduleSong, MAX_VOICE_SEC } from "./sound.js";
import { audioBufferToWav } from "./wav.js";

export const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const MAX_DURATION = 180; // 秒。楽譜がおかしくて長すぎるときに止める
const VOICE_TAIL = 1.5; // 秒。最後の声のあとに残す余韻

export async function renderSong(score, assets = { voice: null }) {
  if (!score || !score.tracks) throw new Error("楽譜がありません");
  if (!(score.duration > 0) || score.duration > MAX_DURATION) throw new Error(`曲の長さがおかしいです（${score.duration} 秒）`);
  const rendered = await Tone.Offline(async () => {
    await scheduleSong(score, assets);
  }, songLength(score, assets), CHANNELS, SAMPLE_RATE);
  const buffer = rendered.get();
  normalizePeak(buffer);
  return audioBufferToWav(buffer);
}

// 書き出す長さ: 楽譜の長さ。声が最後まで流れきらないときは、声の終わり + 余韻まで伸ばす（アウトロの声が途中で切れないように）
// 余韻は VOICE_TAIL と声のリバーブの長さ（score.sound.reverbDecay。息っぽい声では最大 9 秒）の長いほう。声はフェードしないので、響きの途中で切らない
export function songLength(score, assets) {
  const voiceSec = Math.min(assets?.voice?.duration ?? 0, MAX_VOICE_SEC);
  const tail = Math.max(VOICE_TAIL, score.sound?.reverbDecay ?? 0);
  const voiceEnd = Math.max(0, ...(voiceSec ? score.tracks.voice ?? [] : []).map((e) => e.time + (e.duration ?? voiceSec) + tail));
  return Math.max(score.duration, voiceEnd);
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
