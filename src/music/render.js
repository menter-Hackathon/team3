// 【曲2】楽譜 → 音声ファイル（WAV の Blob）。
//
// 書くもの:
//   renderSong(score, assets) → WAV の Blob
//
// 参考（Tone.Offline は、曲の長さを待たずに一気に書き出す）:
//   const rendered = await Tone.Offline(() => {
//     scheduleSong(score, assets);           // sound.js
//   }, score.duration, 2, 44100);            // 長さ（秒）・チャンネル数・サンプルレート
//   return audioBufferToWav(rendered.get()); // wav.js
//   画面ではこの WAV を <audio> で流すと、「聞いた曲」と「持ち帰る曲」が同じになる

export async function renderSong(score, assets = {}) {
  // TODO(曲2)
  return null;
}
