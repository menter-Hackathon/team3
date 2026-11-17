// 【入力1】声を録音して、特徴（大きさ・高さなど）を数字にする。
// 声は個人情報なので、ブラウザの中だけで使い、保存・送信しない。
//
// 書くもの:
//   recordVoice(ms)      → { buffer: AudioBuffer, features: analyzeVoice の結果 }  声を ms ミリ秒録音する
//   analyzeVoice(buffer) → { loudness, pitch, … }  声の特徴を数字にする（設計図に使うもの）
//
// 参考（録音）:
//   const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
//   const recorder = new MediaRecorder(stream);
//   const chunks = [];
//   recorder.addEventListener("dataavailable", (e) => chunks.push(e.data));
//   recorder.start();  // … ms 待ってから recorder.stop()、"stop" イベントを待つ
//   const blob = new Blob(chunks, { type: recorder.mimeType });
//   const buffer = await Tone.getContext().decodeAudioData(await blob.arrayBuffer()); // import * as Tone from "tone"
//   stream.getTracks().forEach((track) => track.stop()); // 最後にマイクを止める
//
// 参考（特徴）:
//   大きさ: buffer.getChannelData(0) の値の2乗の平均の平方根（RMS）
//   高さ: 自己相関（autocorrelation）で基本周波数を推定する、など

export async function recordVoice(ms = 5000) {
  // TODO(入力1)
  return null;
}

export function analyzeVoice(buffer) {
  // TODO(入力1)
  return {};
}
