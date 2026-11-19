// 【出力・たいが】楽譜 → 音声ファイル（WAV の Blob）。
// 受け渡しの形は docs/interfaces.md の「7. 楽譜」「8. 出力」。
//
// 書くもの:
//   renderSong(score, assets) → WAV の Blob（audio/wav、44.1kHz・16bit・ステレオ）
//     曲が作れないときは例外を投げてよい（UI がエラー画面を出す）
//
// 参考（Tone.Offline は、曲の長さを待たずに一気に書き出す）:
//   const rendered = await Tone.Offline(() => {
//     scheduleSong(score, assets);           // sound.js
//   }, score.duration, 2, 44100);            // 長さ（秒）・チャンネル数・サンプルレート
//   return audioBufferToWav(rendered.get()); // wav.js
//   画面ではこの WAV を <audio> で流すと、「聞いた曲」と「持ち帰る曲」が同じになる

export async function renderSong(score, assets = { voice: null }) {
  // TODO(出力・たいが)
  return null;
}
