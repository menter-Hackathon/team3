// 【UI】画面の流れ。各担当の部品（input/・sensor/・music/・visual/）をここでつなぐ。
// はじめる → 声 → 叩く → 10問 → 曲をつくる → 聞く・持ち帰る
import * as Tone from "tone";
import "./style.css";
import { SAMPLE_BLUEPRINT } from "./blueprint.js";
import { recordVoice } from "./input/voice.js";
import { analyzeTaps } from "./input/tap.js";
import { QUESTIONS, CHOICES } from "./input/quiz.js";
import { toBlueprint } from "./input/toBlueprint.js";
import { connectHeart } from "./sensor/heart.js";
import { captureFace } from "./sensor/face.js";
import { compose } from "./music/compose.js";
import { renderSong } from "./music/render.js";
import { drawVisual } from "./visual/sketch.js";

const VOICE_MS = 5000;
const TAP_MS = 10000;

const app = document.querySelector("#app");
let materials = {};
let heart = null;
let songUrl = null;
let visual = null;

startScreen();

function startScreen() {
  materials = { voice: null, taps: null, quiz: null, heart: null, face: null };
  show(
    h("h1", {}, "らしさ（仮）"),
    h("p", {}, "声・リズム・10の質問から、あなただけの1分の曲をつくります。"),
    h("button", { onclick: () => begin() }, "はじめる"),
    h("button", { class: "sub", onclick: () => begin(true) }, "見本の設計図で曲だけつくる（開発用）"),
  );
}

async function begin(sampleOnly = false) {
  await Tone.start(); // 音はクリックのあとでないと鳴らせない
  if (sampleOnly) return makeSong(SAMPLE_BLUEPRINT, {});
  heart = connectHeart();
  voiceScreen();
}

function voiceScreen() {
  const status = h("p", {}, `名前や好きな言葉を話してください（${VOICE_MS / 1000}秒）。`);
  const record = h("button", {
    onclick: async () => {
      record.disabled = true;
      status.textContent = "録音中…";
      try {
        materials.voice = await recordVoice(VOICE_MS);
        tapScreen();
      } catch (error) {
        console.error(error);
        status.textContent = "マイクが使えませんでした。声なしで進めます。";
        record.disabled = false;
      }
    },
  }, "録音する");
  show(h("h2", {}, "1. 声"), status, record, h("button", { class: "sub", onclick: tapScreen }, "スキップ"));
}

function tapScreen() {
  const times = [];
  let done = false;
  const next = () => {
    if (done) return; // 時間切れとスキップが両方来ても1回だけ進む
    done = true;
    materials.taps = analyzeTaps(times);
    quizScreen(0, []);
  };
  const status = h("p", {}, `好きなリズムで叩いてください（最初に叩いてから${TAP_MS / 1000}秒）。`);
  const pad = h("div", { class: "tap-pad" }, "ここを叩く");
  pad.addEventListener("pointerdown", () => {
    if (times.length === 0) setTimeout(next, TAP_MS);
    times.push(performance.now());
    pad.textContent = `${times.length}回`;
  });
  show(h("h2", {}, "2. リズム"), status, pad, h("button", { class: "sub", onclick: next }, "スキップ"));
}

function quizScreen(index, answers) {
  if (index >= QUESTIONS.length) {
    materials.quiz = answers;
    return finish();
  }
  const shownAt = performance.now();
  const choices = CHOICES.map((label, i) =>
    h("button", {
      class: "choice",
      onclick: () => {
        answers.push({ value: i + 1, ms: performance.now() - shownAt });
        quizScreen(index + 1, answers);
      },
    }, label),
  );
  show(
    h("h2", {}, `3. 質問 ${index + 1} / ${QUESTIONS.length}`),
    h("p", { class: "question" }, QUESTIONS[index].text),
    h("div", { class: "choices" }, ...choices),
  );
}

async function finish() {
  materials.heart = heart?.bpm ? { bpm: heart.bpm } : null;
  heart?.close();
  heart = null;
  materials.face = await captureFace();
  makeSong(toBlueprint(materials), { voice: materials.voice?.buffer });
}

async function makeSong(blueprint, assets) {
  show(h("h2", {}, "曲をつくっています…"));
  try {
    const score = compose(blueprint);
    const [wav, title] = await Promise.all([renderSong(score, assets), fetchTitle(blueprint)]);
    resultScreen(blueprint, wav, title);
  } catch (error) {
    console.error(error);
    show(h("h2", {}, "曲をつくれませんでした"), h("pre", {}, String(error)), h("button", { onclick: startScreen }, "最初に戻る"));
  }
}

// 曲名と解説（AI）。失敗しても曲は聞けるように、決まった曲名を返す
async function fetchTitle(blueprint) {
  try {
    const response = await fetch("/api/title", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(blueprint),
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn("曲名を取れませんでした", error);
    return { title: "あなたの曲", comment: "" };
  }
}

function resultScreen(blueprint, wav, title) {
  if (songUrl) URL.revokeObjectURL(songUrl);
  songUrl = URL.createObjectURL(wav);
  const visualBox = h("div", { class: "visual" });
  show(
    h("h2", {}, title.title),
    h("p", {}, title.comment ?? ""),
    h("audio", { controls: "", src: songUrl }),
    h("a", { class: "button", href: songUrl, download: "rashisa.wav" }, "曲を保存する（WAV）"),
    visualBox,
    h("details", {}, h("summary", {}, "設計図（開発用）"), h("pre", {}, JSON.stringify(blueprint, null, 2))),
    h("button", { class: "sub", onclick: startScreen }, "もう一度"),
  );
  visual?.remove();
  drawVisual(visualBox, blueprint).then((instance) => (visual = instance));
}

// --- 画面を組み立てる小さな道具 ---

function show(...nodes) {
  app.replaceChildren(...nodes);
}

function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("on")) element.addEventListener(key.slice(2), value);
    else element.setAttribute(key, value);
  }
  element.append(...children);
  return element;
}
