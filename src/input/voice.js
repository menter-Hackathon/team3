// 【入力】声を録音して、特徴（大きさ・速さ・間・リズム・アクセント・高さの動き・澄み/明るさ）を数字にする。
// 声は個人情報なので、ブラウザの中だけで使い、保存・送信しない。
//
// recordVoice(ms)      → 声の WAV（Blob、audio/wav、16bit・モノラル）/ null（マイクが使えない・声が入っていない）
//   切る前の録音そのまま。UI がそのまま materials.voiceWav として出力の toBlueprint に渡す
//   （無音を切る・特徴を測るのは toBlueprint が detectSpeech・analyzeVoice・trimBuffer で行う）
// analyzeVoice(buffer, speech?) → features（声が入っていなければ { duration, loudness: 0, pitchHz: null }）
// detectSpeech(data, sampleRate) → 声のある区間 / null
// trimBuffer(raw, speech) → { buffer: 前後の無音を切った AudioBuffer, start: 切り出し開始位置（サンプル） }
//
// features（時刻はすべて秒。「声が始まったところ」を 0 とする。割合・強さは 0〜1）
//   大きさ   loudness            話している部分の大きさ（RMS）
//            loudnessVariation   大きさの強弱の幅（大きい声と小さい声の差）
//   速さ・間 speechRate          話す速さ（音節/秒。間をふくむ）
//            articulationRate    話す速さ（音節/秒。間をのぞく）
//            speed               話す速さを 0〜1 に（0 ゆっくり、1 早口）。目安の値で、実際の声で調整する前提
//            speechRatio         話している区間のうち、声が出ていた割合
//            pauseCount          0.2 秒以上の間の数
//            longestPause        一番長い間（秒）
//            speechDuration      話していた長さ（秒）
//            leadSilence         録音を始めてから話し始めるまでの時間（秒）。ためらい・間合い
//   リズム   syllableTimes       音節（声の山）の時刻の配列
//            rhythmRegularity    音節の間隔のそろい具合（1 に近いほど一定）
//   アクセント accentStrength    強く言った音節と普通の音節の差（0〜1）
//            accentTimes         強く言った音節の時刻の配列
//   高さ     pitchHz / pitchNote 声の高さ（Hz の中央値）と音名（"D3" の形、シャープのみ）
//            pitchLowHz / pitchHighHz と pitchLowNote / pitchHighNote  低いほう・高いほう（下位10%・上位10%）
//            pitchVariation      抑揚（高さの上下の幅 ÷ 1オクターブ、0〜1）
//            pitchContourHz      [[時刻, Hz], …] 0.1 秒ごとの高さの動き（声の高さが取れた所だけ）
//            voicedRatio         話している区間のうち、高さが取れた（母音など）割合
//   声質     clarity             声の澄み具合（1 に近いほどはっきりした声、低いとささやき・息まじり）
//            brightness          声の明るさ（高い音の成分の多さ、0〜1）
//            spectralCentroidHz  brightness のもとの値（Hz）
//   動き     loudnessContour     [[時刻, 大きさ], …] 0.1 秒ごとの大きさの動き
//   そのほか duration            buffer の長さ（秒）
//            onsetInBuffer       buffer の中で声が始まる時刻（秒）
// 取れなかった特徴は null（高さが取れない録音なら pitchHz 系は null、音節が少なすぎるなら speed・rhythm・accent は null）。
import * as Tone from "tone";
import { clamp, median } from "../util.js";

// 画面に出す「話してもらうテーマ」。UI 側で使う
export const VOICE_THEME = "好きなことについて、話してください";

const FRAME_SEC = 0.02; // 声があるかの判定・高さ・音節は 20ms ごとに見る
const PAD_SEC = 0.15; // 無音を切るとき、声の前後に残す長さ
const MIN_PEAK = 0.01; // これより小さいと「何も録れていない」
const MIN_SPEECH_FRAMES = 10; // 声のある区間が合計 0.2 秒より短いと「声なし」
const PAUSE_FRAMES = 10; // この長さ（0.2 秒）以上の無音を「間」とする
const PITCH_MIN_HZ = 70;
const PITCH_MAX_HZ = 500;
const MIN_CLARITY = 0.5; // 周期性がこれより弱い区間は「高さなし」（ささやき・子音など）
const MIN_PITCH_FRAMES = 5;
const MIN_SYLLABLES = 4;
const MIN_SYLLABLE_GAP = 5; // 音節どうしは 0.1 秒以上あける
const SPEED_SLOW = 1.5; // speechRate がこれ以下なら speed 0（音節/秒）
const SPEED_FAST = 6; // これ以上なら speed 1
const CONTOUR_FRAMES = 5; // 動きの記録は 0.1 秒ごと
const FFT_SIZE = 1024;
const CENTROID_LOW_HZ = 500; // brightness: この重心なら 0
const CENTROID_HIGH_HZ = 3000; // この重心なら 1
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// ms ミリ秒録音して、声の WAV（Blob）を返す。失敗しても例外は投げず null を返す（声なしで曲を作る）
export async function recordVoice(ms = 5000) {
  let stream = null;
  try {
    // 分析のため、自動音量調整（大声と小声の差が消える）とエコー除去は切る。ノイズ除去は展示の雑音対策に残す
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: false },
    });
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    recorder.addEventListener("dataavailable", (e) => chunks.push(e.data));
    const stopped = new Promise((resolve) => recorder.addEventListener("stop", resolve));

    recorder.start();
    await new Promise((resolve) => setTimeout(resolve, ms));
    recorder.stop();
    await stopped;

    const blob = new Blob(chunks, { type: recorder.mimeType });
    const raw = await Tone.getContext().decodeAudioData(await blob.arrayBuffer());
    const mono = toMono(raw);
    if (!detectSpeech(mono, raw.sampleRate)) return null; // 何も話していない

    return encodeWavBlob(mono, raw.sampleRate);
  } catch (error) {
    console.warn("声を録音できませんでした", error);
    return null;
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
  }
}

// チャンネルを平均して1本にする（マイクがステレオで返しても、声の大きさが変わらないように）
function toMono(buffer) {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const out = new Float32Array(buffer.length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < out.length; i++) out[i] += data[i] / buffer.numberOfChannels;
  }
  return out;
}

// -1〜1 の音 → WAV（16bit PCM・モノラル）の Blob。
// 出力の wav.js と同じ形式だが、入力と出力は直接呼び合わない決まりなので、入力の中に小さく持つ
function encodeWavBlob(samples, sampleRate) {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (offset, s) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true); // fmt の大きさ
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // モノラル
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // 1秒あたりのバイト数
  view.setUint16(32, 2, true); // 1サンプルのバイト数
  view.setUint16(34, 16, true); // 16bit
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = clamp(samples[i], -1, 1);
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Blob([view.buffer], { type: "audio/wav" });
}

// 声の特徴。声が入っていなければ { duration, loudness: 0, pitchHz: null }（受け渡しのルールの最小の形）。
// speech は detectSpeech の結果（渡さなければここで求める）
export function analyzeVoice(buffer, speech = null) {
  const data = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  speech = speech ?? detectSpeech(data, sampleRate);
  if (!speech) return { duration: round(buffer.duration), loudness: 0, pitchHz: null };
  const { frame, rms, isSpeech, first, last, speechFrames } = speech;
  const frameSec = frame / sampleRate;
  const spanSec = (last - first + 1) * frameSec;

  // 大きさと、強弱の幅（小さい声と大きい声の差を dB で。30dB 差で 1）
  const levels = [];
  let squares = 0;
  for (let f = first; f <= last; f++) {
    if (!isSpeech[f]) continue;
    levels.push(rms[f]);
    squares += rms[f] * rms[f];
  }
  levels.sort((a, b) => a - b);
  const loudness = clamp(Math.sqrt(squares / speechFrames), 0, 1);
  const dbRange = 20 * Math.log10(quantile(levels, 0.9) / Math.max(quantile(levels, 0.1), 1e-6));
  const loudnessVariation = clamp(dbRange / 30, 0, 1);

  // 間
  const pauses = [];
  let run = 0;
  for (let f = first; f <= last + 1; f++) {
    if (f <= last && !isSpeech[f]) run++;
    else {
      if (run >= PAUSE_FRAMES) pauses.push(run * frameSec);
      run = 0;
    }
  }

  // 音節・リズム・アクセント・速さ
  const syllables = findSyllables(rms, isSpeech, first, last);
  const syllableTimes = syllables.map((s) => round((s.index + 0.5) * frameSec));
  const enough = syllables.length >= MIN_SYLLABLES;
  const speechRate = enough ? syllables.length / spanSec : null;
  const articulationRate = enough ? syllables.length / (speechFrames * frameSec) : null;
  const speed = enough ? clamp((speechRate - SPEED_SLOW) / (SPEED_FAST - SPEED_SLOW), 0, 1) : null;

  let rhythmRegularity = null;
  const gaps = syllables.slice(1).map((s, i) => (s.index - syllables[i].index) * frameSec).filter((g) => g < 0.6);
  if (gaps.length >= 3) {
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length);
    rhythmRegularity = clamp(1 - sd / mean / 0.6, 0, 1);
  }

  let accentStrength = null;
  let accentTimes = [];
  if (enough) {
    const peaks = syllables.map((s) => s.level).sort((a, b) => a - b);
    accentStrength = clamp(quantile(peaks, 0.9) / median(peaks) - 1, 0, 1);
    const limit = quantile(peaks, 0.75);
    accentTimes = syllables.filter((s) => s.level >= limit).map((s) => round((s.index + 0.5) * frameSec));
  }

  // 高さ・澄み
  const voiced = estimatePitches(data, sampleRate, speech);
  let pitch = null, pitchNote = null, pitchLow = null, pitchHigh = null;
  let pitchLowNote = null, pitchHighNote = null, pitchVariation = null, clarity = null;
  let pitchContour = [];
  if (voiced.length >= MIN_PITCH_FRAMES) {
    const hzList = voiced.map((v) => v.hz);
    const sortedHz = [...hzList].sort((a, b) => a - b);
    const mid = median(hzList);
    pitch = round1(mid);
    pitchNote = noteName(mid);
    pitchLow = round1(quantile(sortedHz, 0.1));
    pitchHigh = round1(quantile(sortedHz, 0.9));
    pitchLowNote = noteName(pitchLow);
    pitchHighNote = noteName(pitchHigh);
    pitchVariation = clamp((12 * Math.log2(pitchHigh / pitchLow)) / 12, 0, 1);
    clarity = voiced.reduce((a, v) => a + v.clarity, 0) / voiced.length;
    pitchContour = contour(first, last, (from, to) => {
      const hz = voiced.filter((v) => v.f >= from && v.f < to).map((v) => v.hz);
      return hz.length ? round1(median(hz)) : null;
    }, frameSec);
  }
  const voicedRatio = voiced.length / speechFrames;

  // 明るさ（スペクトルの重心）
  const centroids = spectralCentroids(data, sampleRate, speech);
  const spectralCentroid = centroids.length ? median(centroids) : null;
  const brightness = spectralCentroid === null
    ? null
    : clamp((spectralCentroid - CENTROID_LOW_HZ) / (CENTROID_HIGH_HZ - CENTROID_LOW_HZ), 0, 1);

  const loudnessContour = contour(first, last, (from, to) => {
    let sum = 0;
    for (let f = from; f < Math.min(to, last + 1); f++) sum += rms[f];
    return round(sum / (Math.min(to, last + 1) - from), 4);
  }, frameSec);

  return {
    loudness: round(loudness, 4),
    loudnessVariation: round(loudnessVariation),
    speechRate: speechRate === null ? null : round(speechRate),
    articulationRate: articulationRate === null ? null : round(articulationRate),
    speed: speed === null ? null : round(speed),
    speechRatio: round(speechFrames / (last - first + 1)),
    pauseCount: pauses.length,
    longestPause: round(pauses.length ? Math.max(...pauses) : 0),
    speechDuration: round(spanSec),
    leadSilence: round(first * frameSec),
    syllableTimes,
    rhythmRegularity: rhythmRegularity === null ? null : round(rhythmRegularity),
    accentStrength: accentStrength === null ? null : round(accentStrength),
    accentTimes,
    pitchHz: pitch,
    pitchNote,
    pitchLowHz: pitchLow,
    pitchHighHz: pitchHigh,
    pitchLowNote,
    pitchHighNote,
    pitchVariation: pitchVariation === null ? null : round(pitchVariation),
    pitchContourHz: pitchContour,
    voicedRatio: round(voicedRatio),
    clarity: clarity === null ? null : round(clarity),
    brightness: brightness === null ? null : round(brightness),
    spectralCentroidHz: spectralCentroid === null ? null : Math.round(spectralCentroid),
    loudnessContour,
    duration: round(buffer.duration),
    onsetInBuffer: round(first * frameSec),
  };
}

// 20ms ごとの大きさ（RMS）から、声のある区間を見つける。無ければ null。
// しきい値は録音の中の静かさ・大きさから決める（マイクの感度が違っても使えるように）
export function detectSpeech(data, sampleRate) {
  const frame = Math.max(1, Math.round(sampleRate * FRAME_SEC));
  const count = Math.floor(data.length / frame);
  if (count < MIN_SPEECH_FRAMES) return null;

  const rms = new Float32Array(count);
  for (let f = 0; f < count; f++) {
    let sum = 0;
    for (let i = f * frame; i < (f + 1) * frame; i++) sum += data[i] * data[i];
    rms[f] = Math.sqrt(sum / frame);
  }
  const sorted = Array.from(rms).sort((a, b) => a - b);
  const noise = sorted[Math.floor(count * 0.1)]; // 一番静かな部分 = 背景の雑音
  const peak = sorted[Math.floor(count * 0.95)]; // 声の大きい部分
  if (peak < MIN_PEAK) return null;

  const threshold = Math.max(noise * 2.5, peak * 0.15);
  const isSpeech = Array.from(rms, (v) => v > threshold);
  const first = isSpeech.indexOf(true);
  const last = isSpeech.lastIndexOf(true);
  const speechFrames = isSpeech.filter(Boolean).length;
  if (first < 0 || speechFrames < MIN_SPEECH_FRAMES) return null;

  return { frame, rms, isSpeech, first, last, speechFrames };
}

// 声のある区間（前後に少し余裕をつけて）だけを切り出した AudioBuffer と、切り出し開始位置（サンプル）。出力の toBlueprint も使う
export function trimBuffer(raw, speech) {
  const pad = Math.round(raw.sampleRate * PAD_SEC);
  const start = Math.max(0, speech.first * speech.frame - pad);
  const end = Math.min(raw.length, (speech.last + 1) * speech.frame + pad);
  const out = Tone.getContext().createBuffer(raw.numberOfChannels, end - start, raw.sampleRate);
  for (let ch = 0; ch < raw.numberOfChannels; ch++) {
    out.copyToChannel(raw.getChannelData(ch).slice(start, end), ch);
  }
  return { buffer: out, start };
}

// 音節（声の大きさの山）を見つける。index は speech.first からのフレーム番号、level は山の高さ。
// 3フレームでならしてから山を取り、近すぎる山・谷が浅い山は1つにまとめる（大きいほうを残す）
function findSyllables(rms, isSpeech, first, last) {
  const n = last - first + 1;
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = rms[Math.max(first, first + i - 1)];
    const c = rms[Math.min(last, first + i + 1)];
    env[i] = (a + rms[first + i] + c) / 3;
  }
  const kept = [];
  for (let i = 0; i < n; i++) {
    const left = i > 0 ? env[i - 1] : 0;
    const right = i < n - 1 ? env[i + 1] : 0;
    if (!(env[i] > left && env[i] >= right && isSpeech[first + i])) continue;
    const peak = { index: i, level: env[i] };
    const prev = kept[kept.length - 1];
    if (prev) {
      let valley = Infinity;
      for (let j = prev.index; j <= i; j++) valley = Math.min(valley, env[j]);
      const shallow = valley > 0.8 * Math.min(prev.level, peak.level);
      if (i - prev.index < MIN_SYLLABLE_GAP || shallow) {
        if (peak.level > prev.level) kept[kept.length - 1] = peak;
        continue;
      }
    }
    kept.push(peak);
  }
  return kept;
}

// 声のある 20ms ごとに、自己相関で基本周波数（Hz）を推定する。高さが判定できた区間だけ返す
// → [{ f: フレーム番号, hz, clarity: 0〜1 }]
function estimatePitches(data, sampleRate, speech) {
  // 高さの推定には高い音は要らないので、約 12kHz まで間引いて計算を軽くする
  const step = Math.max(1, Math.floor(sampleRate / 12000));
  const rate = sampleRate / step;
  const ds = new Float32Array(Math.floor(data.length / step));
  for (let i = 0; i < ds.length; i++) {
    let sum = 0;
    for (let j = 0; j < step; j++) sum += data[i * step + j];
    ds[i] = sum / step;
  }

  const minLag = Math.ceil(rate / PITCH_MAX_HZ);
  const maxLag = Math.floor(rate / PITCH_MIN_HZ);
  const win = Math.round(rate * FRAME_SEC * 2); // 判定する 20ms の前後をふくむ 40ms
  if (win < maxLag + 20) return [];

  const result = [];
  for (let f = speech.first; f <= speech.last; f++) {
    if (!speech.isSpeech[f]) continue;
    const center = Math.round(((f + 0.5) * speech.frame) / step);
    const from = center - Math.round(win / 2);
    if (from < 0 || from + win > ds.length) continue;
    const found = pitchOfWindow(ds.subarray(from, from + win), rate, minLag, maxLag);
    if (found) result.push({ f, ...found });
  }
  return result;
}

function pitchOfWindow(w, rate, minLag, maxLag) {
  const r = new Float32Array(maxLag + 2);
  let best = 0;
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let xy = 0;
    let xx = 0;
    let yy = 0;
    for (let i = 0; i + lag < w.length; i++) {
      xy += w[i] * w[i + lag];
      xx += w[i] * w[i];
      yy += w[i + lag] * w[i + lag];
    }
    r[lag] = xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : 0; // -1〜1。周期があるほど 1 に近い
    if (lag >= minLag && lag <= maxLag) best = Math.max(best, r[lag]);
  }
  if (best < MIN_CLARITY) return null;

  // 一番強い山ではなく、それに近い強さの山のうち一番短い周期を選ぶ（オクターブ下に外れにくい）
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (r[lag] >= 0.9 * best && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1]) {
      const a = r[lag - 1];
      const b = r[lag];
      const c = r[lag + 1];
      const denom = a - 2 * b + c;
      const shift = denom ? clamp((0.5 * (a - c)) / denom, -0.5, 0.5) : 0; // 山の頂点を細かく推定
      return { hz: rate / (lag + shift), clarity: clamp(best, 0, 1) };
    }
  }
  return null;
}

// 声のある 20ms ごとのスペクトルの重心（Hz）。高い音の成分が多いほど大きい
function spectralCentroids(data, sampleRate, speech) {
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const hann = Float64Array.from({ length: FFT_SIZE }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
  const binHz = sampleRate / FFT_SIZE;
  const lo = Math.ceil(100 / binHz);
  const hi = Math.min(FFT_SIZE / 2 - 1, Math.floor(8000 / binHz));
  const out = [];
  for (let f = speech.first; f <= speech.last; f++) {
    if (!speech.isSpeech[f]) continue;
    const from = Math.round((f + 0.5) * speech.frame) - FFT_SIZE / 2;
    if (from < 0 || from + FFT_SIZE > data.length) continue;
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = data[from + i] * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    let num = 0;
    let den = 0;
    for (let k = lo; k <= hi; k++) {
      const mag = Math.hypot(re[k], im[k]);
      num += k * binHz * mag;
      den += mag;
    }
    if (den > 0) out.push(num / den);
  }
  return out;
}

// 小さな FFT（要素数は 2 のべき乗）
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

// 声の区間を 0.1 秒ずつに区切り、pick(開始フレーム, 終了フレーム) の値を [時刻, 値] で並べる（null は除く）
function contour(first, last, pick, frameSec) {
  const list = [];
  for (let from = first; from <= last; from += CONTOUR_FRAMES) {
    const value = pick(from, from + CONTOUR_FRAMES);
    if (value !== null) list.push([round(((from - first) + CONTOUR_FRAMES / 2) * frameSec), value]);
  }
  return list;
}

function quantile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function round(value, digits = 3) {
  const k = 10 ** digits;
  return Math.round(value * k) / k;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

// Hz → "D3" のような音名（シャープのみ）
function noteName(hz) {
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}
