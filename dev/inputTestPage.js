// 入力1（voice / tap / quiz）の動作確認用ページ。開発用で、本番の画面（index.html）には含まれない。
// 声・叩き・答えは個人情報なので、このページの中だけで使い、保存も送信もしない。
import * as Tone from "tone";
import { recordVoice, analyzeVoice, detectSpeech, trimBuffer, VOICE_THEME } from "../src/input/voice.js";
import { analyzeTaps, measureTapIntervals } from "../src/input/tap.js";
import { QUESTIONS, CHOICES, CHOICE_WEIGHTS, scoreQuiz } from "../src/input/quiz.js";
import { toBlueprint } from "../src/input/toBlueprint.js";
import { audioBufferToWav } from "../src/music/wav.js";

const $ = (id) => document.getElementById(id);

// 出力（toBlueprint）に渡す材料。docs/interfaces.md の「4. 材料」の形
const materials = { voiceWav: null, tapIntervalsMs: null, quiz: null, heart: null, face: null };

// 声の WAV（Blob）→ 表示用に、出力と同じやり方で読み込んで測る
async function inspectVoiceWav(voiceWav) {
  const raw = await Tone.getContext().decodeAudioData(await voiceWav.arrayBuffer());
  const speech = detectSpeech(raw.getChannelData(0), raw.sampleRate);
  const features = analyzeVoice(raw, speech);
  const buffer = speech ? trimBuffer(raw, speech).buffer : raw;
  return { buffer, rawBuffer: raw, features };
}

// ---------- 表示の部品 ----------
const NA = '<span class="null">取れず（null）</span>';
const num = (v, digits = 2) => (v === null || v === undefined ? NA : Number(v).toFixed(digits));
// 0〜1 の値を棒で。center を付けると真ん中に線（-1〜1 の値用）
const bar = (v) => (v === null || v === undefined ? "" : `<span class="bar"><i style="width:${Math.max(0, Math.min(1, v)) * 100}%"></i></span>`);
const row = (label, value, hint = "") => `<tr><th>${label}</th><td>${value}</td><td class="hint">${hint}</td></tr>`;
const json = (value) => `<details><summary>JSON をすべて見る</summary><pre>${JSON.stringify(value, null, 2)}</pre></details>`;

// ---------- 1. 声 ----------
$("theme").textContent = VOICE_THEME;
let playing = null;

function playBuffer(buffer) {
  playing?.stop();
  playing?.dispose();
  playing = new Tone.Player(buffer).toDestination();
  playing.start();
}

function showVoice(voice, note = "") {
  const f = voice.features;
  const rows = [
    row("声の大きさ", `${num(f.loudness, 3)}${bar(Math.min(1, f.loudness * 4))}`, "大きいほど大声（マイクで変わる）"),
    row("強弱の幅", `${num(f.loudnessVariation)}${bar(f.loudnessVariation)}`, "大きい声と小さい声の差"),
    row("話す速さ", `${num(f.speechRate, 1)} 音節/秒 → speed ${num(f.speed)}${bar(f.speed)}`, "0 ゆっくり〜1 早口（目安は仮）"),
    row("間", `${f.pauseCount ?? 0} 回、最長 ${num(f.longestPause)} 秒`, "0.2 秒以上の無音"),
    row("声が出ていた割合", `${num(f.speechRatio)}${bar(f.speechRatio)}`, "低いほど間が多い"),
    row("話し出すまで", `${num(f.leadSilence)} 秒`, "録音開始から声が始まるまで"),
    row("リズムのそろい具合", `${num(f.rhythmRegularity)}${bar(f.rhythmRegularity)}`, "1 に近いほど一定"),
    row("アクセント", `${num(f.accentStrength)}${bar(f.accentStrength)}`, "強く言った音節と普通の差"),
    row("声の高さ", f.pitchHz == null ? NA : `${f.pitchHz} Hz（${f.pitchNote}）`, "中央値"),
    row("低い〜高い", f.pitchLowHz == null ? NA : `${f.pitchLowNote}（${f.pitchLowHz} Hz）〜 ${f.pitchHighNote}（${f.pitchHighHz} Hz）`, "下位10%〜上位10%"),
    row("抑揚", `${num(f.pitchVariation)}${bar(f.pitchVariation)}`, "0 棒読み〜1 1オクターブ以上"),
    row("澄み", `${num(f.clarity)}${bar(f.clarity)}`, "低いとささやき・息まじり"),
    row("明るさ", `${num(f.brightness)}${bar(f.brightness)}`, f.spectralCentroidHz == null ? "" : `重心 ${f.spectralCentroidHz} Hz`),
  ].join("");

  $("voice-result").innerHTML = `
    <div class="row">
      <button id="play-trim">▶ 切った声（曲に使う音）</button>
      <button id="play-raw" class="sub">▶ 録音そのまま</button>
      <span class="legend">${voice.buffer.duration.toFixed(2)} 秒 / 録音 ${voice.rawBuffer.duration.toFixed(2)} 秒 ${note}</span>
    </div>
    <canvas id="chart" width="1440" height="360"></canvas>
    <div class="legend">灰色の面＝声の大きさ　青い点＝声の高さ　下の緑の線＝音節　赤い線＝強く言った音節（横軸は声が始まってからの秒）</div>
    <table>${rows}</table>
    ${json(f)}`;
  $("play-trim").onclick = () => playBuffer(voice.buffer);
  $("play-raw").onclick = () => playBuffer(voice.rawBuffer);
  drawChart($("chart"), f);
}

function drawChart(canvas, f) {
  const ctx = canvas.getContext("2d");
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  const pad = 10;
  const maxT = Math.max(f.speechDuration ?? 1, 0.5);
  const x = (t) => pad + (t / maxT) * (w - pad * 2);

  // 大きさ（面）
  const loud = f.loudnessContour ?? [];
  const maxL = Math.max(0.0001, ...loud.map((p) => p[1]));
  ctx.fillStyle = "#8886";
  loud.forEach(([t, v]) => {
    const bh = (v / maxL) * (h - 50);
    ctx.fillRect(x(t) - 6, h - 20 - bh, 12, bh);
  });

  // 高さ（点と線）
  const pitch = f.pitchContourHz ?? [];
  if (pitch.length) {
    const lo = Math.min(...pitch.map((p) => p[1])) * 0.9;
    const hi = Math.max(...pitch.map((p) => p[1])) * 1.1 || 1;
    const y = (hz) => 10 + (1 - (hz - lo) / Math.max(hi - lo, 1)) * (h - 50);
    ctx.strokeStyle = "#3b82f6";
    ctx.fillStyle = "#3b82f6";
    ctx.lineWidth = 3;
    ctx.beginPath();
    pitch.forEach(([t, hz], i) => (i ? ctx.lineTo(x(t), y(hz)) : ctx.moveTo(x(t), y(hz))));
    ctx.stroke();
    pitch.forEach(([t, hz]) => {
      ctx.beginPath();
      ctx.arc(x(t), y(hz), 5, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.font = "20px sans-serif";
    ctx.fillText(`${Math.round(hi)} Hz`, 14, 24);
    ctx.fillText(`${Math.round(lo)} Hz`, 14, h - 28);
  }

  // 音節（緑）と強い音節（赤）
  const strong = new Set(f.accentTimes ?? []);
  (f.syllableTimes ?? []).forEach((t) => {
    ctx.strokeStyle = strong.has(t) ? "#ef4444" : "#22c55e";
    ctx.lineWidth = strong.has(t) ? 4 : 2;
    ctx.beginPath();
    ctx.moveTo(x(t), h - 18);
    ctx.lineTo(x(t), h - (strong.has(t) ? 48 : 34));
    ctx.stroke();
  });
}

// マイクなしで画面を確かめる用の、合成の声（上がっていく高さ・3つに1つ強い・間あり）
function makeSyntheticVoice() {
  const ctx = Tone.getContext();
  const sr = ctx.sampleRate;
  const total = 6;
  const buffer = ctx.createBuffer(1, Math.round(total * sr), sr);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.002;
  const starts = [];
  for (let k = 0; k < 8; k++) starts.push(0.8 + k * 0.22);
  for (let k = 0; k < 8; k++) starts.push(3.4 + k * 0.22);
  starts.forEach((t, k) => {
    const from = Math.round(t * sr);
    const len = Math.round(0.16 * sr);
    const f0 = 150 + k * 6;
    const amp = k % 3 === 0 ? 0.4 : 0.2;
    let phase = 0;
    for (let i = 0; i < len && from + i < data.length; i++) {
      const env = Math.sin((Math.PI * i) / len) ** 2;
      phase += (2 * Math.PI * f0) / sr;
      let v = 0;
      for (let h = 1; h <= 8; h++) v += Math.sin(h * phase) / h;
      data[from + i] += amp * env * v * 0.5;
    }
  });
  return buffer;
}

$("rec").onclick = async () => {
  const sec = Math.max(2, Math.min(30, Number($("voice-sec").value) || 8));
  $("rec").disabled = true;
  $("voice-result").innerHTML = "";
  await Tone.start();
  let left = sec;
  $("voice-status").textContent = `録音中… 残り ${left} 秒（${VOICE_THEME}）`;
  const timer = setInterval(() => {
    left -= 1;
    if (left > 0) $("voice-status").textContent = `録音中… 残り ${left} 秒（${VOICE_THEME}）`;
  }, 1000);
  const voiceWav = await recordVoice(sec * 1000);
  clearInterval(timer);
  $("rec").disabled = false;
  materials.voiceWav = voiceWav;
  if (!voiceWav) {
    $("voice-status").innerHTML = '<span class="null">声が取れませんでした（null）。マイクの許可・無音・短すぎ、のどれかです。コンソールも見てください。</span>';
    return;
  }
  $("voice-status").textContent = `取れました（${voiceWav.type}、${(voiceWav.size / 1024).toFixed(0)} KB）。この WAV を出力に渡します。`;
  showVoice(await inspectVoiceWav(voiceWav));
};

$("synth").onclick = async () => {
  await Tone.start();
  materials.voiceWav = audioBufferToWav(makeSyntheticVoice());
  $("voice-status").textContent = "合成の声（高さが 150→240Hz、3つに1つ強い、途中に間）を WAV にして解析しました。この WAV を出力に渡します。";
  showVoice(await inspectVoiceWav(materials.voiceWav), "（合成）");
};

// ---------- 2. 叩き ----------
const TAP_MS = 10000;
let tapTimesMs = [];
let tapTimer = null;
let tapTick = null;
let tapStart = 0;

function tapReset() {
  clearTimeout(tapTimer);
  clearInterval(tapTick);
  tapTimes_clear();
  materials.tapIntervalsMs = null;
  $("pad").textContent = "ここを叩く";
  $("pad").classList.remove("active");
  $("tap-status").textContent = "";
  $("tap-result").innerHTML = "";
}
function tapTimes_clear() {
  tapTimesMs = [];
  tapTimer = null;
  tapTick = null;
}

function tapFinish() {
  clearTimeout(tapTimer);
  clearInterval(tapTick);
  $("pad").classList.remove("active");
  const taps = analyzeTaps(tapTimesMs);
  materials.tapIntervalsMs = measureTapIntervals(tapTimesMs);
  $("tap-status").textContent = `${tapTimesMs.length} 回叩きました。出力に渡す間隔: ${
    materials.tapIntervalsMs ? `${materials.tapIntervalsMs.length} 個` : "null（4回未満）"
  }`;
  if (!taps) {
    $("tap-result").innerHTML = `<p class="null">解析できませんでした（null）。4回以上、間隔が 0.15〜2 秒の叩きが3つ以上必要です。</p>${json(tapTimesMs)}`;
    return;
  }
  const grooveRows = taps.groove
    .map((g, i) => row(`${i + 1} 拍目のズレ`, `${(g * 1000).toFixed(0)} ms`, g > 0 ? "遅れ気味（もたる）" : g < 0 ? "走り気味（はねる）" : ""))
    .join("");
  $("tap-result").innerHTML = `<table>
      ${row("速さ", `${taps.bpm} BPM`, "叩いた間隔の中央値から（60〜160）")}
      ${grooveRows}
      ${row("安定度", `${num(taps.stability)}${bar(taps.stability)}`, "1 に近いほど毎回同じ位置で叩けた")}
      ${row("回数", `${taps.count} 回`, "")}
    </table>${json({ taps, tapIntervalsMs: materials.tapIntervalsMs })}`;
}

$("pad").addEventListener("pointerdown", () => {
  const now = performance.now();
  if (tapTimesMs.length === 0) {
    tapStart = now;
    $("pad").classList.add("active");
    $("tap-result").innerHTML = "";
    tapTimer = setTimeout(tapFinish, TAP_MS);
    tapTick = setInterval(() => {
      $("tap-status").textContent = `${tapTimesMs.length} 回　残り ${Math.max(0, (TAP_MS - (performance.now() - tapStart)) / 1000).toFixed(1)} 秒`;
    }, 100);
  }
  tapTimesMs.push(now);
  $("pad").textContent = `${tapTimesMs.length} 回`;
});
$("tap-done").onclick = () => tapTimesMs.length && tapFinish();
$("tap-reset").onclick = tapReset;

// ---------- 3. 10問 ----------
const TRAITS = {
  extraversion: "外向性",
  agreeableness: "協調性",
  conscientiousness: "誠実性",
  neuroticism: "神経症傾向",
  openness: "開放性",
};

$("questions").innerHTML = QUESTIONS.map(
  (q, i) => `<div class="q"><p>${i + 1}. ${q.text}<span class="legend">（${TRAITS[q.trait]}${q.reverse ? "・逆転" : ""}）</span></p>${CHOICES.map(
    (label, c) => `<label><input type="radio" name="q${i}" value="${c + 1}" /> ${label}<span class="legend">(${CHOICE_WEIGHTS[c] > 0 ? "+" : ""}${CHOICE_WEIGHTS[c]})</span></label>`,
  ).join("")}</div>`,
).join("");

// 回答時間: このページは10問を一度に出すので、「前に答えてから（最初は表示してから）この問に答えるまで」で測る
const responseMs = new Array(QUESTIONS.length).fill(0);
let lastAnswerAt = performance.now();

function currentAnswers() {
  return QUESTIONS.map((_, i) => {
    const checked = document.querySelector(`input[name="q${i}"]:checked`);
    return { value: checked ? Number(checked.value) : undefined, responseMs: Math.round(responseMs[i]) };
  });
}

function updateQuiz(event) {
  const index = Number(event?.target?.name?.slice(1));
  if (Number.isInteger(index)) {
    const now = performance.now();
    responseMs[index] = now - lastAnswerAt;
    lastAnswerAt = now;
  }
  const answers = currentAnswers();
  const answered = answers.filter((a) => a.value).length;
  // 途中までなら null（docs/interfaces.md の「4. 材料」）
  materials.quiz = answered === QUESTIONS.length ? answers : null;
  const traits = scoreQuiz(answers);
  $("quiz-result").innerHTML = `<p class="note">答えた数 ${answered} / ${QUESTIONS.length}（未回答は「どちらでもない」として計算）</p><table>${Object.entries(traits)
    .map(([key, v]) => row(TRAITS[key], `${num(v)}${bar(v)}`, v > 0.55 ? "高め" : v < 0.45 ? "低め" : "中間"))
    .join("")}</table>${json({ answers, traits })}`;
}

function fill(pick) {
  QUESTIONS.forEach((_, i) => {
    const value = pick(i);
    document.querySelectorAll(`input[name="q${i}"]`).forEach((el) => (el.checked = value !== null && Number(el.value) === value));
  });
  updateQuiz();
}
$("questions").addEventListener("change", updateQuiz);
$("fill-mid").onclick = () => fill(() => 3);
$("fill-high").onclick = () => fill(() => 5);
$("fill-random").onclick = () => fill(() => 1 + Math.floor(Math.random() * 5));
$("fill-clear").onclick = () => fill(() => null);
updateQuiz();

// ---------- 4. 出力に渡す ----------
$("handoff").onclick = async () => {
  $("handoff").disabled = true;
  await Tone.start();
  const given = {
    voiceWav: materials.voiceWav ? `Blob（${materials.voiceWav.type}、${(materials.voiceWav.size / 1024).toFixed(0)} KB）` : null,
    tapIntervalsMs: materials.tapIntervalsMs,
    quiz: materials.quiz,
    heart: null,
    face: null,
  };
  const { blueprint, assets } = await toBlueprint(materials);
  $("handoff").disabled = false;
  const s = blueprint.sources;
  const mark = (ok) => (ok ? "届いた" : '<span class="null">なし</span>');
  $("handoff-result").innerHTML = `<table>
      ${row("声", mark(s.voice), s.voice ? `root ${blueprint.rootFromVoice ? blueprint.root : "（高さが取れず原曲のまま）"}・melodyRange ${num(blueprint.melodyRange)}・breathiness ${num(blueprint.breathiness)}` : "")}
      ${row("叩き", mark(s.taps), s.taps ? `bpm ${blueprint.bpm}・stability ${num(blueprint.stability)}・tempoDrift ${blueprint.tempoDrift ?? "—"}` : "")}
      ${row("10問", mark(s.quiz), s.quiz ? "使い方は出力（うごてん）の TODO" : "10問すべてに答えると渡る")}
      ${row("曲に流す声", assets.voice ? `${assets.voice.duration.toFixed(2)} 秒 <button id="play-assets" class="sub">▶</button>` : '<span class="null">null</span>', "無音を切った声")}
    </table>
    <details open><summary>渡した材料</summary><pre>${JSON.stringify(given, null, 2)}</pre></details>
    ${json(blueprint)}`;
  if (assets.voice) $("play-assets").onclick = () => playBuffer(assets.voice);
};
