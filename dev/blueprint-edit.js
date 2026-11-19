// 設計図で MIDI を編集する流れを、ブラウザで確かめるためのページ（開発用。本番の画面では使わない）。
// npm run dev → http://localhost:5173/dev/blueprint-edit.html
import * as Tone from "tone";
import { Midi } from "@tonejs/midi";
import { NOTES, SCALES, SAMPLE_BLUEPRINT, defaultBlueprint } from "../src/blueprint.js";
import { editMidiFromBlueprint } from "../src/music/edit/blueprintEdit.js";
import { isDrum, findParts } from "../src/music/parts.js";
import { soundFromBlueprint } from "../src/music/soundSettings.js";
import { midiToScore } from "../src/music/midiToScore.js";
import { renderSong } from "../src/music/render.js";
import { toBlueprint } from "../src/input/toBlueprint.js";
import { fitLength } from "../src/music/compose.js";

const $ = (id) => document.getElementById(id);
const grooveInputs = [...document.querySelectorAll(".groove")];
let original = null; // 原曲の Midi
let edited = null; // 編集の結果
let stopPlaying = null;

for (const n of NOTES) {
  $("songRoot").append(new Option(n, n));
  $("bpRoot").append(new Option(n, n));
}
for (const s of Object.keys(SCALES)) $("songScale").append(new Option(s, s, false, s === "ionian"));

// 画面の入力 ↔ 設計図
function readBlueprint() {
  return {
    ...defaultBlueprint(),
    root: $("bpRoot").value,
    rootFromVoice: $("bpRootFromVoice").checked,
    melodyRange: Number($("bpMelodyRange").value),
    breathiness: Number($("bpBreathiness").value),
    bpm: Number($("bpBpm").value),
    stability: Number($("bpStability").value),
    tempoDrift: Number($("bpTempoDrift").value),
    groove: grooveInputs.map((el) => Number(el.value)),
    sources: { voice: $("srcVoice").checked, taps: $("srcTaps").checked, quiz: false, heart: $("srcHeart").checked, face: false },
  };
}
function writeBlueprint(bp) {
  $("bpRoot").value = bp.root;
  $("bpRootFromVoice").checked = bp.rootFromVoice;
  $("bpMelodyRange").value = bp.melodyRange;
  $("bpBreathiness").value = bp.breathiness;
  $("bpBpm").value = bp.bpm;
  $("bpStability").value = bp.stability;
  $("bpTempoDrift").value = bp.tempoDrift;
  grooveInputs.forEach((el, i) => (el.value = bp.groove[i]));
  $("srcVoice").checked = bp.sources.voice;
  $("srcTaps").checked = bp.sources.taps;
  $("srcHeart").checked = bp.sources.heart;
  update();
}
writeBlueprint(defaultBlueprint());

for (const el of document.querySelectorAll("fieldset input, fieldset select")) {
  if (el.id !== "midiFile" && !el.closest(".materials")) el.addEventListener("change", update);
}
$("useSampleBlueprint").addEventListener("click", () => writeBlueprint(SAMPLE_BLUEPRINT));
$("useDefaultBlueprint").addEventListener("click", () => writeBlueprint(defaultBlueprint()));

$("midiFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (file) setOriginal(new Midi(await file.arrayBuffer()), file.name);
});
for (const b of document.querySelectorAll("button.song")) {
  b.addEventListener("click", async () => {
    const res = await fetch(`/songs/song${b.dataset.song}.mid`);
    $("songRoot").value = ""; // キーは MIDI の "key: …" のテキストから読む
    setOriginal(new Midi(await res.arrayBuffer()), `song${b.dataset.song}.mid`);
  });
}
$("useSample").addEventListener("click", () => {
  $("songRoot").value = "D";
  $("songScale").value = "dorian";
  setOriginal(makeSampleMidi(), "仮の原曲");
});

$("playOriginal").addEventListener("click", () => play(original, soundFromBlueprint({})));
$("playEdited").addEventListener("click", () => play(edited.midi, soundFromBlueprint(readBlueprint())));
$("stop").addEventListener("click", () => stopPlaying?.());
$("download").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([edited.bytes], { type: "audio/midi" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: "edited.mid" });
  a.click();
  URL.revokeObjectURL(url);
});

function setOriginal(midi, label) {
  original = midi;
  const drums = midi.tracks.filter((t) => t.notes.length && isDrum(t)).length;
  $("midiInfo").textContent = `${label}: ${midi.tracks.length} トラック（ドラム ${drums}）、${midi.duration.toFixed(1)} 秒`;
  update();
}

function update() {
  if (!original) return;
  const songKey = $("songRoot").value ? { root: $("songRoot").value, scale: $("songScale").value } : null;
  // compose と同じ順: テンポに合わせて約1分になる小節の数を決め、頭からその小節だけにしてから編集する
  const fitted = fitLength(original, readBlueprint());
  layout = fitted.layout;
  edited = editMidiFromBlueprint(fitted.midi, readBlueprint(), songKey);
  const r = edited.report;
  const hatName = { 4: "4分音符（間引く）", 8: "8分音符", 16: "16分音符（細かく）" };
  const s = r.sound;
  const rows = [
    ["原曲のキー → 編集後のキー", `${r.songKey} → ${r.newKey}（${r.shift >= 0 ? "+" : ""}${r.shift} 半音）`],
    ["メロディ（トラック・音域の倍率）", `${r.melodyTrack ?? "なし"}・${r.rangeFactor} 倍`],
    ["メロディの音域（半音）", r.melodySpan ? `${r.melodySpan.before.semitones} → ${r.melodySpan.after.semitones}` : "メロディなし"],
    ["リバーブ・パッド", s ? `リバーブ ${s.reverbDecay} 秒・${s.reverbWet} / パッド 立ち上がり ${s.padAttack} 秒・消え方 ${s.padRelease} 秒・${s.padFilterHz} Hz` : "原曲のまま"],
    ["テンポ", r.tempo],
    ["ドラムの細かさ（ハイハット）", r.hats ? `${hatName[r.hats.division]}（${r.hats.before} → ${r.hats.after} 音）` : "原曲のまま"],
    ["ノリ（4拍のズレ、ミリ秒）", r.groove ? r.groove.map((s) => Math.round(s * 1000)).join(" / ") : "なし（原曲のまま）"],
    ["揺らぎ", r.humanize || "なし"],
    ["曲の長さ（小節）", `イントロ ${layout.introBars}・1問 ${layout.barsPerQuestion} × 10・アウトロ ${layout.outroBars} ＝ ${layout.totalBars} 小節（見込み ${layout.estimatedSec} 秒）`],
    ["長さ", `原曲 ${original.duration.toFixed(1)} 秒 → 使う所を編集して ${edited.midi.duration.toFixed(1)} 秒`],
    ["注意", r.warnings.join(" / ") || "なし"],
  ];
  $("result").replaceChildren(
    ...rows.map(([k, v]) => {
      const tr = document.createElement("tr");
      tr.append(Object.assign(document.createElement("td"), { textContent: k }));
      tr.append(Object.assign(document.createElement("td"), { textContent: String(v) }));
      return tr;
    }),
  );
  for (const id of ["playOriginal", "playEdited", "download"]) $(id).disabled = false;
  showScore();
}

// ── 楽譜（MIDI → Score） ─────────────────────────
let score = null;
let layout = null; // 曲の長さの小節の数（fitLength）

function showScore() {
  const result = midiToScore(edited.midi, readBlueprint(), layout);
  score = result.score;
  const r = result.report;
  const c = r.counts;
  const rows = [
    ["長さ（余韻込み）・BPM", `${score.duration} 秒・${score.bpm} BPM`],
    ["トラックの割り当て", `melody ← ${r.melodyTrack ?? "なし"} / pad ← ${r.padTrack ?? "なし"} / bass ← ${r.bassTrack ?? "なし"} / ドラム ← ${r.drumTracks.join("・") || "なし"}`],
    ["音の数", `melody ${c.melody}・pad ${c.pad}（和音）・bass ${c.bass}・kick ${c.kick}・snare ${c.snare}・hat ${c.hat}・voice ${c.voice}`],
    ["曲の構成（秒）", score.structure.map((s) => `${s.name} ${s.start}`).join(" / ")],
    ["フェードアウト（音楽だけ）", score.fade ? `${score.fade.start} → ${score.fade.end} 秒（声は残る）` : "なし"],
    ["声を置く所", score.tracks.voice.map((v) => `${v.time} 秒から${v.duration ? ` ${v.duration} 秒` : "最後まで（最大 10 秒）"}`).join("、")],
    ["音の柔らかさ（sound）", `リバーブ ${score.sound.reverbDecay} 秒・${score.sound.reverbWet} / パッド ${score.sound.padAttack}・${score.sound.padRelease} 秒・${score.sound.padFilterHz} Hz`],
    ["注意", r.warnings.join(" / ") || "なし"],
  ];
  $("scoreResult").replaceChildren(
    ...rows.map(([k, v]) => {
      const tr = document.createElement("tr");
      tr.append(Object.assign(document.createElement("td"), { textContent: k }));
      tr.append(Object.assign(document.createElement("td"), { textContent: String(v) }));
      return tr;
    }),
  );
  $("playScore").disabled = $("downloadScore").disabled = $("renderWav").disabled = false;
}

// ── 材料 → 設計図（toBlueprint） ───────────────────────
let voiceBuffer = null; // 声の AudioBuffer（toBlueprint の assets.voice）
let tapTimes = []; // 叩いた時刻（間隔を作るため）
let tapIntervals = null; // 叩いた間隔（ミリ秒の配列）
let tapTimer = null;

$("tapPad").addEventListener("pointerdown", () => {
  tapTimes.push(performance.now());
  $("tapPad").classList.add("hit");
  setTimeout(() => $("tapPad").classList.remove("hit"), 80);
  clearTimeout(tapTimer);
  $("materialInfo").textContent = `${tapTimes.length} 回叩きました…`;
  // 1.5 秒叩かなければ、ひとまとまりとして間隔にする（次に叩いたら新しく数え直す）
  tapTimer = setTimeout(() => {
    setTapIntervals(tapTimes.slice(1).map((t, i) => Math.round(t - tapTimes[i])));
    tapTimes = [];
  }, 1500);
});
$("tapReset").addEventListener("click", () => {
  tapTimes = [];
  setTapIntervals(null);
});
// 見本の叩き方（間隔のミリ秒）
const TAP_SAMPLES = {
  steady: Array.from({ length: 14 }, (_, i) => 750 + Math.round(Math.sin(i * 7.3) * 5)), // 80 BPM・安定
  rush: Array.from({ length: 20 }, (_, i) => Math.round(430 * (1 - (0.12 * i) / 20) + Math.sin(i * 7.3) * 8)), // 速い・だんだん速く
  loose: Array.from({ length: 14 }, (_, i) => 600 + Math.round(Math.sin(i * 7.3) * 110)), // 100 BPM・バラバラ
  subdivide: [...Array(8).fill(600), ...Array(16).fill(300)].map((ms, i) => ms + Math.round(Math.sin(i * 7.3) * 4)), // 100 BPM・途中から8分音符
};
document.querySelectorAll("[data-sample]").forEach((b) =>
  b.addEventListener("click", () => {
    tapTimes = [];
    setTapIntervals(TAP_SAMPLES[b.dataset.sample]);
  }),
);
function setTapIntervals(list) {
  tapIntervals = list;
  $("materialInfo").textContent = list
    ? `叩いた間隔 ${list.length} 個: ${list.slice(0, 10).join(", ")}${list.length > 10 ? " …" : ""}（ミリ秒）`
    : "叩いていません";
}

$("makeBlueprint").addEventListener("click", async () => {
  const voiceWav = $("materialVoice").files[0] ?? null;
  const heart = $("useHeart").checked ? { bpm: Number($("heartBpm").value) } : null;
  const { blueprint, assets } = await toBlueprint({ voiceWav, tapIntervalsMs: tapIntervals, quiz: null, heart, face: null });
  voiceBuffer = assets.voice;
  writeBlueprint(blueprint);
  const s = blueprint.sources;
  $("materialInfo").textContent =
    `設計図を作りました（声 ${s.voice ? (blueprint.rootFromVoice ? "○" : "○（高さが取れないのでキーは原曲のまま）") : voiceWav ? "×（声が入っていない）" : "なし"}` +
    `・叩く ${s.taps ? "○" : tapIntervals ? "×（少なすぎる）" : "なし"}・心拍 ${s.heart ? "○" : "なし"}` +
    `${voiceBuffer ? `・声の音 ${voiceBuffer.duration.toFixed(1)} 秒` : ""}）`;
});

// ── WAV に書き出す（楽譜 → renderSong） ───────────────────
let wavUrl = null;

$("renderWav").addEventListener("click", async () => {
  stopPlaying?.();
  $("renderWav").disabled = true;
  $("renderInfo").textContent = "書き出し中…";
  const startedAt = performance.now();
  try {
    const wav = await renderSong(score, { voice: voiceBuffer });
    if (wavUrl) URL.revokeObjectURL(wavUrl);
    wavUrl = URL.createObjectURL(wav);
    $("wavPlayer").src = wavUrl;
    const now = new Date();
    const pad2 = (n) => String(n).padStart(2, "0");
    Object.assign($("wavLink"), {
      href: wavUrl,
      download: `rashisa-${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}.wav`,
      hidden: false,
    });
    $("renderInfo").textContent = `${score.duration} 秒の曲を ${((performance.now() - startedAt) / 1000).toFixed(1)} 秒で書き出しました（${(wav.size / 1024 / 1024).toFixed(1)} MB${voiceBuffer ? "・声あり" : "・声なし"}）`;
  } catch (err) {
    $("renderInfo").textContent = `書き出せませんでした: ${err.message}`;
  } finally {
    $("renderWav").disabled = false;
  }
});

$("playScore").addEventListener("click", () => playScore(score));
$("stopScore").addEventListener("click", () => stopPlaying?.());
$("downloadScore").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(score, null, 2)], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: "score.json" });
  a.click();
  URL.revokeObjectURL(url);
});

// 楽譜をそのまま鳴らす（楽譜の形が Tone.js で鳴らせることを確かめる。同じトラックで同じ time があればここでエラーになる）
async function playScore(s) {
  stopPlaying?.();
  await Tone.start();
  const fadeGain = new Tone.Gain(1).toDestination();
  const reverb = new Tone.Reverb({ decay: s.sound.reverbDecay, wet: s.sound.reverbWet }).connect(fadeGain);
  const out = new Tone.Limiter(-1).connect(reverb);
  const melody = new Tone.Synth({ oscillator: { type: "custom", partials: s.timbre }, volume: -10 }).connect(out);
  const bass = new Tone.Synth({ oscillator: { type: "sine" }, volume: -6 }).connect(out);
  const padFilter = new Tone.Filter(s.sound.padFilterHz, "lowpass").connect(out);
  const pad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sawtooth" },
    envelope: { attack: s.sound.padAttack, release: s.sound.padRelease },
    volume: -18,
  }).connect(padFilter);
  const kick = new Tone.MembraneSynth({ volume: -6 }).connect(out);
  const snare = new Tone.NoiseSynth({ envelope: { decay: 0.15, sustain: 0 }, volume: -16 }).connect(out);
  const hat = new Tone.MetalSynth({ envelope: { decay: 0.05 }, volume: -30 }).connect(out);
  const synths = [melody, bass, pad, padFilter, kick, snare, hat, out, reverb, fadeGain];

  const start = Tone.now() + 0.2;
  if (s.fade) {
    fadeGain.gain.setValueAtTime(1, start + s.fade.start);
    fadeGain.gain.exponentialRampToValueAtTime(0.0001, start + s.fade.end);
  }
  for (const e of s.tracks.melody) melody.triggerAttackRelease(e.note, e.duration, start + e.time, e.velocity);
  for (const e of s.tracks.bass) bass.triggerAttackRelease(e.note, e.duration, start + e.time, e.velocity);
  for (const e of s.tracks.pad) pad.triggerAttackRelease(e.notes, e.duration, start + e.time, e.velocity);
  for (const e of s.tracks.kick) kick.triggerAttackRelease("C1", 0.2, start + e.time, e.velocity);
  for (const e of s.tracks.snare) snare.triggerAttackRelease(0.1, start + e.time, e.velocity);
  for (const e of s.tracks.hat) hat.triggerAttackRelease("C6", 0.03, start + e.time, e.velocity);

  const timer = setTimeout(() => stopPlaying?.(), (s.duration + 1) * 1000);
  stopPlaying = () => {
    clearTimeout(timer);
    synths.forEach((x) => x.dispose());
    stopPlaying = null;
  };
}

// MIDI を簡単な音で鳴らす（確かめるためだけの音。本番の音作りは別）
async function play(midi, sound) {
  stopPlaying?.();
  await Tone.start();
  const reverb = new Tone.Reverb({ decay: sound.reverbDecay, wet: sound.reverbWet }).toDestination();
  const out = new Tone.Limiter(-1).connect(reverb);
  const lead = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "triangle" }, volume: -10 }).connect(out);
  const padFilter = new Tone.Filter(sound.padFilterHz, "lowpass").connect(out);
  const pad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sawtooth" },
    envelope: { attack: sound.padAttack, release: sound.padRelease },
    volume: -18,
  }).connect(padFilter);
  const kick = new Tone.MembraneSynth({ volume: -6 }).connect(out);
  const hit = new Tone.NoiseSynth({ envelope: { decay: 0.08, sustain: 0 }, volume: -22 }).connect(out);
  const synths = [lead, pad, padFilter, kick, hit, out, reverb];

  const start = Tone.now() + 0.2;
  if (s.fade) {
    fadeGain.gain.setValueAtTime(1, start + s.fade.start);
    fadeGain.gain.exponentialRampToValueAtTime(0.0001, start + s.fade.end);
  }
  const parts = findParts(midi);
  // ドラムは全トラックをまとめ、同じ時刻の音は1つにする（同じ時刻に2回鳴らすと Tone.js がエラーになる）
  const kicks = new Set(), hits = new Set();
  for (const track of midi.tracks) {
    for (const n of track.notes) {
      if (!isDrum(track)) (track === parts.pad ? pad : lead).triggerAttackRelease(n.name, n.duration, start + n.time, n.velocity * 0.6);
      else if (n.midi === 35 || n.midi === 36) kicks.add(n.time);
      else hits.add(n.time);
    }
  }
  for (const t of kicks) kick.triggerAttackRelease("C1", 0.2, start + t, 0.9);
  for (const t of hits) if (!kicks.has(t)) hit.triggerAttackRelease(0.05, start + t, 0.6);

  const timer = setTimeout(() => stopPlaying?.(), (midi.duration + sound.reverbDecay + 1) * 1000);
  stopPlaying = () => {
    clearTimeout(timer);
    synths.forEach((s) => s.dispose());
    stopPlaying = null;
  };
}

// 仮の原曲: D dorian・4/4・90 BPM・24小節（イントロ2 + 1問2小節 × 10 + アウトロ2）。トラックは melody / pad / bass / drums
function makeSampleMidi() {
  const midi = new Midi();
  midi.header.setTempo(90);
  midi.header.meta.push({ type: "text", text: "key: D dorian", ticks: 0 });
  const beat = 60 / 90;
  const add = (name, notes, channel = 0) => {
    const t = midi.addTrack();
    t.name = name;
    t.channel = channel;
    notes.forEach(([m, b, d, v = 0.8]) => t.addNote({ midi: m, time: b * beat, duration: d * beat, velocity: v }));
  };
  const phrase = [[62, 0, 1], [65, 1, 0.5], [67, 1.5, 0.5], [69, 2, 1.5], [72, 3.5, 0.5], [71, 4, 1], [69, 5, 1], [67, 6, 2],
    [65, 8, 1], [67, 9, 0.5], [69, 9.5, 0.5], [74, 10, 1.5], [72, 11.5, 0.5], [69, 12, 1], [67, 13, 1], [62, 14, 2]];
  add("melody", Array.from({ length: 6 }, (_, k) => phrase.map(([m, b, d]) => [m, b + 16 * k, d])).flat());
  const chords = [[50, 53, 57, 60], [55, 59, 62, 65], [53, 57, 60, 64], [57, 60, 64, 67]]; // Dm7 G7 Fmaj7 Am7
  const padNotes = [], bassNotes = [];
  for (let bar = 0; bar < 24; bar++) {
    const c = chords[bar % 4];
    c.forEach((m) => padNotes.push([m, bar * 4, 4, 0.5]));
    bassNotes.push([c[0] - 12, bar * 4, 1.5, 0.8], [c[0] - 12, bar * 4 + 2, 1.5, 0.7]);
  }
  add("pad", padNotes);
  add("bass", bassNotes);
  const drums = [];
  for (let b = 0; b < 96; b++) {
    drums.push(b % 2 === 0 ? [36, b, 0.25, 0.9] : [38, b, 0.25, 0.7]);
    drums.push([42, b + 0.5, 0.25, 0.4]);
  }
  add("drums", drums, 9);
  return new Midi(midi.toArray());
}
