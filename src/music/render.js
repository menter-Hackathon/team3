// 【出力・たいが】楽譜 → 音声ファイル（WAV の Blob）。
// 受け渡しの形は docs/interfaces.md の「7. 楽譜」「8. 出力」。
//
// renderSong(score, assets) → Promise<Blob>（audio/wav、44.1kHz・16bit・ステレオ）
//   曲が作れないときは例外を投げる（UI がエラー画面を出す）
//   Tone.js の OfflineContext で、曲の長さを待たずに一気に書き出す（Tone.start() は要らない）
//   長さは score.duration。声（duration なし＝最後まで）がそれより長く続くときは、声の終わり + 声のリバーブの余韻まで伸ばす
//   画面ではこの WAV を <audio> で流すと、「聞いた曲」と「持ち帰る曲」が同じになる
//
// 速く書き出すために、曲を PART_SEC 秒ずつの「部分」に分けて、同時に書き出してから重ねる
//   Tone.js は書き出しの前に、曲じゅうの音の部品を全部作ってしまう。作られた部品は、自分が鳴る前から毎回処理されるので、
//   1分の曲を1回で書き出すと、音の数 × 曲の長さぶん重くなる（パッドの和音が多い曲で20秒以上かかっていた）
//   部分ごとに、そこで鳴り始める音だけを入れると、部品が処理される時間が短くなる。部分どうしは別々のスレッドで同時に書き出される
//   音は鳴り始めた部分の中で最後（リリースとリバーブの余韻）まで鳴らすので、部分の境目で音が切れない。楽器と音色は sound.js のまま
import * as Tone from "tone";
import { scheduleSong, MAX_VOICE_SEC, KNOWN_TRACKS } from "./sound.js";
import { audioBufferToWav } from "./wav.js";

export const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const MAX_DURATION = 180; // 秒。楽譜がおかしくて長すぎるときに止める
const VOICE_TAIL = 1.5; // 秒。最後の声のあとに残す余韻
const PART_SEC = 8; // 秒。1つの部分の長さ（サンプル数が整数になる長さにする）
// 秒。音の長さのあとに残す最小の余韻。sound.js の楽器でリリースが一番長いのは鐘（0.3＋0.8 秒）、キックは 0.3 秒＋リリース 0.4 秒。
// コーラス・ビブラートの遅れは数ミリ秒。パッドとメロディのリリースは score.sound から足す。sound.js でこれより長く残る楽器を足したら、ここも伸ばす
const NOTE_TAIL = 2;
const MAX_REVERB_SEC = 10; // 楽譜に sound がないときに見込むリバーブの長さ
// 同時に1音しか鳴らない楽器のトラック。元は次の音が来ると前の音が止まるので、部分の境目をまたぐ音は次の音の時刻で切る
// （ドラムは sound.js で長さが決まっていて短く、余韻も小さいので切らない）
const MONO_TRACKS = ["bass"];

export async function renderSong(score, assets = { voice: null }) {
  if (!score || !score.tracks) throw new Error("楽譜がありません");
  if (!(score.duration > 0) || score.duration > MAX_DURATION) throw new Error(`曲の長さがおかしいです（${score.duration} 秒）`);
  const total = songLength(score, assets);
  const parts = splitScore(score, assets, total);
  const buffers = await renderParts(parts, assets);
  const length = Math.ceil(total * SAMPLE_RATE);
  const channels = Array.from({ length: CHANNELS }, () => new Float32Array(length));
  parts.forEach((part, i) => {
    const offset = Math.round(part.offset * SAMPLE_RATE);
    for (let c = 0; c < CHANNELS; c++) {
      const data = buffers[i].getChannelData(c);
      const out = channels[c];
      const n = Math.min(data.length, length - offset);
      for (let j = 0; j < n; j++) out[offset + j] += data[j];
    }
  });
  const buffer = { numberOfChannels: CHANNELS, sampleRate: SAMPLE_RATE, length, getChannelData: (c) => channels[c] };
  normalizePeak(buffer);
  return audioBufferToWav(buffer);
}

// 部分ごとに楽器を作って音を予約し（ここは順番に）、そのあと全部の部分を同時に書き出す
// scheduleSong は最初の await（リバーブの準備）より前に楽器を全部作るので、そのあいだだけ、その部分の context を既定にしておく
// 書き出しは途中で止められないので、どれかが失敗しても全部が終わるのを待ってから、書き出し用の context をすべて片付ける
async function renderParts(parts, assets) {
  const original = Tone.getContext();
  const jobs = [];
  try {
    try {
      for (const part of parts) {
        const context = new Tone.OfflineContext(CHANNELS, part.length, SAMPLE_RATE);
        Tone.setContext(context);
        jobs.push({ context, scheduled: scheduleSong(part.score, part.hasVoice ? assets : { voice: null }) });
      }
    } finally {
      Tone.setContext(original);
    }
    const results = await Promise.allSettled(
      jobs.map(async ({ context, scheduled }) => {
        await scheduled;
        return context.render();
      }),
    );
    const failed = results.find((r) => r.status === "rejected");
    if (failed) throw failed.reason;
    return results.map((r) => r.value);
  } finally {
    await Promise.allSettled(jobs.map((job) => job.scheduled));
    for (const { context } of jobs) context.dispose();
  }
}

// 楽譜を PART_SEC 秒ずつの部分に分ける。音は鳴り始める部分に入れ、時刻はその部分の頭からに直す
// 部分の長さ: 中の音が鳴り終わる時刻 + 余韻（リリース・リバーブ）。曲の終わり（total）を超えない
// フェードの途中には区切りを置かない（フェードの時刻を部分ごとにずらすだけで、同じ形でかかるように）
// 区間（sections）の時刻も部分ごとにずらす（部分の前に始まった区間は負の時刻になり、sound.js がその値から始める）
export function splitScore(score, assets, total = songLength(score, assets)) {
  const sound = score.sound ?? {};
  const reverb = sound.reverbDecay ?? MAX_REVERB_SEC;
  const noteTail = Math.max(NOTE_TAIL, sound.padRelease ?? 0, sound.melodyRelease ?? 0) + reverb;
  const voiceTail = Math.max(VOICE_TAIL, reverb);
  const voiceSec = Math.min(assets?.voice?.duration ?? 0, MAX_VOICE_SEC);
  const fade = score.fade && score.fade.end > score.fade.start ? score.fade : null;
  const lastCut = Math.min(score.duration, fade ? fade.start : Infinity);
  const starts = [0];
  for (let t = PART_SEC; t < lastCut; t += PART_SEC) starts.push(t);

  const partIndex = (time) => {
    let i = starts.length - 1;
    while (i > 0 && time < starts[i]) i--;
    return i;
  };
  const parts = starts.map((offset) => ({ offset, tracks: {}, end: 0, hasVoice: false }));
  for (const [name, events] of Object.entries(score.tracks)) {
    if (!KNOWN_TRACKS.includes(name)) {
      console.warn(`楽譜の知らないトラック「${name}」は鳴らしません`);
      continue;
    }
    const list = events ?? [];
    list.forEach((original, k) => {
      const e = { ...original };
      const i = partIndex(e.time);
      const next = list[k + 1];
      if (MONO_TRACKS.includes(name) && next && partIndex(next.time) !== i && e.duration > next.time - e.time) {
        e.duration = Math.max(0, next.time - e.time);
      }
      const part = parts[i];
      (part.tracks[name] ??= []).push({ ...e, time: e.time - part.offset });
      if (name === "voice") {
        if (!voiceSec) return; // 声がないときは鳴らないので、長さに入れない
        part.hasVoice = true;
        part.end = Math.max(part.end, e.time - part.offset + (e.duration ?? voiceSec) + voiceTail);
      } else {
        part.end = Math.max(part.end, e.time - part.offset + (e.duration ?? 0) + noteTail);
      }
    });
  }
  return parts
    .filter((p) => p.end > 0)
    .map((p) => {
      const length = Math.min(p.end, total - p.offset);
      const partFade = fade ? { start: fade.start - p.offset, end: fade.end - p.offset } : score.fade;
      const partSections = (score.sections ?? []).map((s) => ({ ...s, start: s.start - p.offset, end: s.end - p.offset }));
      return { offset: p.offset, length, hasVoice: p.hasVoice, score: { ...score, duration: length, tracks: p.tracks, fade: partFade, sections: partSections } };
    });
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
