// 【曲2】AudioBuffer → WAV の Blob。
//
// 書くもの:
//   audioBufferToWav(buffer) → new Blob([データ], { type: "audio/wav" })
//
// 参考（16bit PCM の WAV）:
//   先頭 44 バイトのヘッダを DataView で書く
//   （"RIFF"・全体の大きさ・"WAVE"・"fmt " の情報（チャンネル数・サンプルレートなど）・"data"・データの大きさ）
//   続けて、各サンプル（-1〜1）を 16bit の整数（× 32767）にし、チャンネルを交互に並べて書く
//   「AudioBuffer to WAV」で探すと同じ形のコードが見つかる

export function audioBufferToWav(buffer) {
  // TODO(曲2)
  return null;
}
