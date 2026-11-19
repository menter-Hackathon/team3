// 【出力・たいが】AudioBuffer → WAV の Blob。
// 受け渡しの形は docs/interfaces.md の「8. 出力」。
// ブラウザの機能は Blob だけ（Node でも動く）。
//
// audioBufferToWav(audioBuffer) → new Blob([データ], { type: "audio/wav" })（16bit PCM）
//   audioBuffer は AudioBuffer か、同じ形（numberOfChannels・sampleRate・length・getChannelData(i)）のもの
// encodeWav(channels, sampleRate) → ArrayBuffer（WAV ファイルの中身）
//   channels はチャンネルごとの Float32Array（-1〜1）の配列

export function audioBufferToWav(audioBuffer) {
  const channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, i) => audioBuffer.getChannelData(i));
  return new Blob([encodeWav(channels, audioBuffer.sampleRate)], { type: "audio/wav" });
}

const HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2; // 16bit

export function encodeWav(channels, sampleRate) {
  const numChannels = channels.length;
  const length = channels[0]?.length ?? 0;
  const blockAlign = numChannels * BYTES_PER_SAMPLE;
  const dataBytes = length * blockAlign;
  const buffer = new ArrayBuffer(HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);

  // ヘッダ（すべてリトルエンディアン）
  writeText(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true); // このあとの大きさ
  writeText(view, 8, "WAVE");
  writeText(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt の大きさ
  view.setUint16(20, 1, true); // 1 = PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // 1秒あたりのバイト数
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BYTES_PER_SAMPLE * 8, true); // 16bit
  writeText(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  // データ: チャンネルを交互に並べる（左・右・左・右…）。-1〜1 を超える値は切る
  let offset = HEADER_BYTES;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const s = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += BYTES_PER_SAMPLE;
    }
  }
  return buffer;
}

function writeText(view, offset, text) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}
