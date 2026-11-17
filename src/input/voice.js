// 【入力1】声を録音する。声は個人情報なので、ブラウザの中だけで使い、保存・送信しない。
import * as Tone from "tone";

// ms ミリ秒録音して { buffer: AudioBuffer, features } を返す
export async function recordVoice(ms = 5000) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  try {
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    recorder.addEventListener("dataavailable", (e) => chunks.push(e.data));
    const stopped = new Promise((resolve) => recorder.addEventListener("stop", resolve));

    recorder.start();
    await new Promise((resolve) => setTimeout(resolve, ms));
    recorder.stop();
    await stopped;

    const blob = new Blob(chunks, { type: recorder.mimeType });
    const buffer = await Tone.getContext().decodeAudioData(await blob.arrayBuffer());
    return { buffer, features: analyzeVoice(buffer) };
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
}

// 声の特徴。TODO(入力1): 声の高さ（ピッチ）・明るさなどを足して、設計図に使う
export function analyzeVoice(buffer) {
  const data = buffer.getChannelData(0);
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  return { loudness: Math.sqrt(sum / data.length), duration: buffer.duration };
}
