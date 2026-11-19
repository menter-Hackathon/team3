// 瞬きのテスト（開発用）。src/sensor/blink.js を試し、人によって瞬きのリズムが違うかを比べる。
import { startBlinks, summarizeBlinks } from "/src/sensor/blink.js";

const MEASURE_MS = 60000;
const $ = (id) => document.getElementById(id);

let tracker = null;
let startedAt = 0;
let fpsMark = { at: 0, frames: 0 };
let measureStart = null;
let audio = null;
const records = [];

$("start").addEventListener("click", async () => {
  $("start").disabled = true;
  $("status").textContent = "カメラとモデルを準備しています…";
  audio ??= new AudioContext();
  tracker = await startBlinks({ video: $("video"), onBlink });
  if (!tracker) {
    $("status").textContent = "カメラかモデルを使えませんでした。カメラの許可とネットの接続を確認してください。";
    $("start").disabled = false;
    return;
  }
  startedAt = performance.now();
  $("status").textContent = "動いています。画面を見ながら、自然に瞬きしてください。";
  $("measure").disabled = false;
  $("stop").disabled = false;
  syncSliders();
  requestAnimationFrame(draw);
});

$("stop").addEventListener("click", () => {
  tracker?.stop();
  tracker = null;
  measureStart = null;
  $("start").disabled = false;
  $("measure").disabled = true;
  $("stop").disabled = true;
  $("status").textContent = "止めました。";
});

$("measure").addEventListener("click", () => {
  measureStart = performance.now();
  $("measure").disabled = true;
  setTimeout(finishMeasure, MEASURE_MS);
});

for (const id of ["closeAbove", "openBelow"]) {
  $(id).addEventListener("input", () => {
    if (!tracker) return;
    tracker.detector.options[id] = Number($(id).value);
    syncSliders();
  });
}

function syncSliders() {
  const o = tracker.detector.options;
  $("closeAbove").value = o.closeAbove;
  $("openBelow").value = o.openBelow;
  $("closeText").textContent = o.closeAbove.toFixed(2);
  $("openText").textContent = o.openBelow.toFixed(2);
  $("markClose").style.left = `${o.closeAbove * 100}%`;
  $("markOpen").style.left = `${o.openBelow * 100}%`;
}

function onBlink() {
  $("video").classList.add("flash");
  setTimeout(() => $("video").classList.remove("flash"), 120);
  if (!$("sound").checked || !audio) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.frequency.value = 1320;
  gain.gain.setValueAtTime(0.15, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.08);
  osc.connect(gain).connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + 0.1);
}

function draw() {
  if (!tracker) return;
  const now = performance.now();
  const summary = summarizeBlinks(tracker.timesMs, startedAt, now);
  $("fill").style.width = `${tracker.score * 100}%`;
  $("scoreText").textContent = tracker.score.toFixed(2);
  $("face").textContent = tracker.faceVisible ? "見えている" : "見えていない";
  $("count").textContent = summary.count;
  $("rate").textContent = now - startedAt > 10000 ? summary.perMinute : "…";
  $("left").textContent = measureStart === null ? "-" : `${Math.max(0, Math.ceil((MEASURE_MS - (now - measureStart)) / 1000))}秒`;
  if (now - fpsMark.at >= 1000) {
    $("fps").textContent = fpsMark.at ? Math.round(((tracker.frames - fpsMark.frames) * 1000) / (now - fpsMark.at)) : "…";
    fpsMark = { at: now, frames: tracker.frames };
  }
  requestAnimationFrame(draw);
}

function finishMeasure() {
  if (!tracker || measureStart === null) return;
  const summary = summarizeBlinks(tracker.timesMs, measureStart, measureStart + MEASURE_MS);
  const record = {
    label: $("label").value || `${records.length + 1}人目`,
    count: summary.count,
    perMinute: summary.perMinute,
    timesSec: summary.timesMs.map((t) => Math.round((t - measureStart) / 10) / 100), // はかり始めからの秒
  };
  records.push(record);
  measureStart = null;
  $("measure").disabled = false;
  addRow(record);
  $("json").textContent = JSON.stringify(records, null, 1);
}

function addRow(record) {
  const row = document.createElement("tr");
  const canvas = document.createElement("canvas");
  row.innerHTML = `<td>${escapeHtml(record.label)}</td><td>${record.count}</td><td>${record.perMinute}</td><td></td>`;
  row.lastElementChild.append(canvas);
  $("results").append(row);
  canvas.width = canvas.clientWidth * devicePixelRatio;
  canvas.height = canvas.clientHeight * devicePixelRatio;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = getComputedStyle(document.body).color;
  ctx.globalAlpha = 0.15;
  ctx.fillRect(0, canvas.height / 2 - 1, canvas.width, 2);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#e8457a";
  for (const sec of record.timesSec) {
    ctx.fillRect((sec / (MEASURE_MS / 1000)) * canvas.width - 1.5 * devicePixelRatio, 4, 3 * devicePixelRatio, canvas.height - 8);
  }
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
