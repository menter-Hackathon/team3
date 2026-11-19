// 声で MIDI を編集する流れを、ブラウザで確かめるためのページ（開発用。本番の画面では使わない）。
// npm run dev → http://localhost:5173/dev/voice-edit.html
import * as Tone from "tone";
import { Midi } from "@tonejs/midi";
import { NOTES, SCALES } from "../src/blueprint.js";
import { editMidiFromWav } from "../src/music/edit/fromWav.js";
import { voiceSound, findParts } from "../src/music/edit/voiceEdit.js";

const $ = (id) => document.getElementById(id);
let original = null; // 原曲の Midi
let wav = undefined; // 声の WAV（File）。null は「声なし」
let edited = null; // 編集の結果
let stopPlaying = null;

for (const n of NOTES) $("songRoot").append(new Option(n, n));
for (const s of Object.keys(SCALES)) $("songScale").append(new Option(s, s, false, s === "ionian"));

$("midiFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  setOriginal(new Midi(await file.arrayBuffer()), file.name);
});
$("useSample").addEventListener("click", () => {
  setOriginal(makeSampleMidi(), "仮の原曲");
  $("songRoot").value = "D";
  $("songScale").value = "dorian";
  update();
});
$("wavFile").addEventListener("change", (e) => {
  wav = e.target.files[0] ?? undefined;
  update();
});
$("noVoice").addEventListener("click", () => {
  wav = null;
  $("wavFile").value = "";
  update();
});
$("songRoot").addEventListener("change", update);
$("songScale").addEventListener("change", update);

$("playOriginal").addEventListener("click", () => play(original, voiceSound(null)));
$("playEdited").addEventListener("click", () => play(edited.midi, edited.params.sound));
$("stop").addEventListener("click", () => stopPlaying?.());
$("download").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([edited.bytes], { type: "audio/midi" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: "edited.mid" });
  a.click();
  URL.revokeObjectURL(url);
});

function setOriginal(midi, label) {
  original = midi;
  const parts = findParts(midi);
  $("midiInfo").textContent =
    `${label}: ${midi.tracks.length} トラック、${midi.duration.toFixed(1)} 秒。` +
    `メロディ = ${parts.melody?.name || "（なし）"}、パッド = ${parts.pad?.name || "（なし）"}、ドラム ${parts.drums.length} トラック`;
  update();
}

async function update() {
  if (!original || wav === undefined) return;
  const songKey = $("songRoot").value ? { root: $("songRoot").value, scale: $("songScale").value } : null;
  edited = await editMidiFromWav(wav, original, songKey);
  const { features: f, params: p, report: r } = edited;
  const rows = [
    ["声の高さ（pitchNote）", f?.pitchNote ?? "取れなかった"],
    ["抑揚（pitchVariation）", f?.pitchVariation ?? "取れなかった"],
    ["澄み具合（clarity）", f?.clarity ?? "取れなかった"],
    ["原曲のキー → 編集後のキー", `${r.songKey} → ${r.newKey}（${r.shift >= 0 ? "+" : ""}${r.shift} 半音）`],
    ["メロディの音域の倍率", r.rangeFactor],
    ["メロディの音域（半音）", r.melodySpan ? `${r.melodySpan.before.semitones} → ${r.melodySpan.after.semitones}` : "メロディなし"],
    ["息っぽさ（breathiness）", p.breathiness],
    ["リバーブ", `長さ ${p.sound.reverbDecay} 秒・混ぜ具合 ${p.sound.reverbWet}`],
    ["パッド", `立ち上がり ${p.sound.padAttack} 秒・消え方 ${p.sound.padRelease} 秒・フィルター ${p.sound.padFilterHz} Hz`],
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
  const parts = findParts(midi);
  const reverb = new Tone.Reverb({ decay: sound.reverbDecay, wet: sound.reverbWet }).toDestination();
  const out = new Tone.Limiter(-1).connect(reverb);
  const lead = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "triangle" }, volume: -8 }).connect(out);
  const padFilter = new Tone.Filter(sound.padFilterHz, "lowpass").connect(out);
  const pad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sawtooth" },
    envelope: { attack: sound.padAttack, release: sound.padRelease },
    volume: -18,
  }).connect(padFilter);
  const bass = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "sine" }, volume: -6 }).connect(out);
  const kick = new Tone.MembraneSynth({ volume: -6 }).connect(out);
  const hit = new Tone.NoiseSynth({ envelope: { decay: 0.08, sustain: 0 }, volume: -22 }).connect(out);
  const synths = [lead, pad, bass, kick, hit, padFilter, out, reverb];

  const start = Tone.now() + 0.2;
  for (const track of parts.pitched) {
    const synth = track === parts.melody ? lead : track === parts.pad ? pad : bass;
    for (const n of track.notes) synth.triggerAttackRelease(n.name, n.duration, start + n.time, n.velocity);
  }
  let lastHit = -1;
  for (const track of parts.drums) {
    for (const n of track.notes) {
      if (n.midi === 35 || n.midi === 36) kick.triggerAttackRelease("C1", 0.2, start + n.time, n.velocity);
      else if (n.time > lastHit) { hit.triggerAttackRelease(0.05, start + n.time, n.velocity); lastHit = n.time; }
    }
  }
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
    if (b % 2 === 0) drums.push([36, b, 0.25, 0.9]);
    else drums.push([38, b, 0.25, 0.7]);
    drums.push([42, b + 0.5, 0.25, 0.4]);
  }
  add("drums", drums, 9);
  return new Midi(midi.toArray());
}
