// 設計図で MIDI を編集する流れを、ブラウザで確かめるためのページ（開発用。本番の画面では使わない）。
// npm run dev → http://localhost:5173/dev/blueprint-edit.html
import * as Tone from "tone";
import { Midi } from "@tonejs/midi";
import { NOTES, SCALES, SAMPLE_BLUEPRINT, defaultBlueprint } from "../src/blueprint.js";
import { editMidiFromBlueprint, isDrum, findParts, soundFromBlueprint } from "../src/music/edit/blueprintEdit.js";

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
  if (el.id !== "midiFile") el.addEventListener("change", update);
}
$("useSampleBlueprint").addEventListener("click", () => writeBlueprint(SAMPLE_BLUEPRINT));
$("useDefaultBlueprint").addEventListener("click", () => writeBlueprint(defaultBlueprint()));

$("midiFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (file) setOriginal(new Midi(await file.arrayBuffer()), file.name);
});
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
  edited = editMidiFromBlueprint(original, readBlueprint(), songKey);
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
    ["長さ", `${original.duration.toFixed(1)} 秒 → ${edited.midi.duration.toFixed(1)} 秒`],
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

// 仮の原曲: D dorian・4/4・90 BPM・8小節。トラックは melody / pad / bass / drums
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
  add("melody", [...phrase, ...phrase.map(([m, b, d]) => [m, b + 16, d])]);
  const chords = [[50, 53, 57, 60], [55, 59, 62, 65], [53, 57, 60, 64], [57, 60, 64, 67]]; // Dm7 G7 Fmaj7 Am7
  const padNotes = [], bassNotes = [];
  for (let bar = 0; bar < 8; bar++) {
    const c = chords[bar % 4];
    c.forEach((m) => padNotes.push([m, bar * 4, 4, 0.5]));
    bassNotes.push([c[0] - 12, bar * 4, 1.5, 0.8], [c[0] - 12, bar * 4 + 2, 1.5, 0.7]);
  }
  add("pad", padNotes);
  add("bass", bassNotes);
  const drums = [];
  for (let b = 0; b < 32; b++) {
    drums.push(b % 2 === 0 ? [36, b, 0.25, 0.9] : [38, b, 0.25, 0.7]);
    drums.push([42, b + 0.5, 0.25, 0.4]);
  }
  add("drums", drums, 9);
  return new Midi(midi.toArray());
}
