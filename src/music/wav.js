// 【出力・たいが】AudioBuffer → WAV の Blob。
// 受け渡しの形は docs/interfaces.md の「8. 出力」。
//
// 書くもの:
//   audioBufferToWav(audioBuffer) → new Blob([データ], { type: "audio/wav" })（16bit）
//
// 参考（16bit PCM の WAV）:
//   先頭 44 バイトのヘッダを DataView で書く
//   （"RIFF"・全体の大きさ・"WAVE"・"fmt " の情報（チャンネル数・サンプルレートなど）・"data"・データの大きさ）
//   続けて、各サンプル（-1〜1）を 16bit の整数（× 32767）にし、チャンネルを交互に並べて書く
//   「AudioBuffer to WAV」で探すと同じ形のコードが見つかる

export function audioBufferToWav(audioBuffer) {
  // TODO(出力・たいが)
  return null;
}
