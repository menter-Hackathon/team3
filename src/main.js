// 【UI】画面の流れ。各担当の部品（input/・music/）をここでつなぐ。
// 受け渡しの形は docs/interfaces.md（部品を呼ぶ順番を決めるのは UI だけ）。
//
// 画面: はじまり → I 声 → II 律動（叩く）→ III 問い（10問）→ IV 紡ぐ（曲をつくる）→ V 聴く・持ち帰る
//   どの材料が取れなくても先へ進める（取れなかった材料は null のまま渡す）
//   曲が作れないとき（compose・renderSong の失敗）は、エラーの画面を出す
//   声・叩き・答えはブラウザの中だけで使う。サーバーに送るのは設計図だけ（曲名を付けるため）
//
// まだつないでいないもの（任意の材料・映像）: 心拍（connectHeart）・顔（captureFace）・映像（drawVisual）
import * as Tone from "tone";
import "./style.css";
import { recordVoice, VOICE_THEME } from "./input/voice.js";
import { measureTapIntervals } from "./input/tap.js";
import { QUESTIONS, CHOICES } from "./input/quiz.js";
import { toBlueprint } from "./input/toBlueprint.js";
import { compose } from "./music/compose.js";
import { renderSong } from "./music/render.js";

const VOICE_MS = 5000; // 声を録音する長さ
const TAP_MS = 10000; // 最初に叩いてから、受け付ける長さ
const TITLE_TIMEOUT_MS = 8000; // 曲名（AI）を待つ長さ。過ぎたら決まった曲名にする
const MIN_MAKING_MS = 3500; // 「紡ぐ」画面を最低これだけ見せる（一瞬で消えないように）
const FALLBACK_TITLE = { title: "あなたの歌", comment: "声と指先と、十の問いから生まれた一分の歌です。", ai: false };
const KANJI = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
const SVG_NS = "http://www.w3.org/2000/svg";

const app = document.querySelector("#app");

// 集めた材料（docs/interfaces.md の「4. 材料」）。心拍・顔は今は使わない
let materials = emptyMaterials();
// 画面を離れるときに止めるもの（タイマー・アニメーション・音）
let cleanups = [];

function emptyMaterials() {
  return { voiceWav: null, tapIntervalsMs: null, quiz: null, heart: null, face: null };
}

// ── 小さな部品 ───────────────────────────────

// h("button", { class: "btn", onclick }, "文字") のように要素を作る
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (value !== false && value != null) el.setAttribute(key, value === true ? "" : value);
  }
  el.append(...children.flat().filter((c) => c != null));
  return el;
}

// SVG の要素は文字列で書く（装飾の形を読みやすくするため）
function svg(markup, attrs = {}) {
  const wrap = document.createElementNS(SVG_NS, "svg");
  for (const [key, value] of Object.entries(attrs)) wrap.setAttribute(key, value);
  wrap.setAttribute("aria-hidden", "true");
  wrap.innerHTML = markup;
  return wrap;
}

// 花びらを輪に並べた SVG の文字列（エンブレム・叩く盤・紡ぐ）
function rosette({ cx, cy, count, size, radius, opacity = 1 }) {
  return Array.from({ length: count }, (_, i) =>
    `<use href="#petal" x="${-size / 4}" y="${-size}" width="${size / 2}" height="${size}" opacity="${opacity}"
      transform="translate(${cx} ${cy}) rotate(${(360 / count) * i}) translate(0 ${-radius})" />`,
  ).join("");
}

const divider = () => svg('<use href="#divider" />', { class: "divider", viewBox: "0 0 240 22" });
const chapter = (numeral, name) => h("div", { class: "chapter" }, numeral, h("b", {}, name));

// 画面を入れ替える。前の画面のタイマーなどは止める
function show(...children) {
  cleanups.forEach((stop) => stop());
  cleanups = [];
  app.replaceChildren(h("section", { class: "screen" }, ...children));
  window.scrollTo(0, 0);
}

function later(fn, ms) {
  const id = setTimeout(fn, ms);
  cleanups.push(() => clearTimeout(id));
}

function every(fn, ms) {
  const id = setInterval(fn, ms);
  cleanups.push(() => clearInterval(id));
  return () => clearInterval(id);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── はじまり ─────────────────────────────────

function startScreen() {
  materials = emptyMaterials();
  show(
    svg(
      `<g class="petals">${rosette({ cx: 60, cy: 60, count: 16, size: 28, radius: 30, opacity: 0.8 })}</g>
       <circle cx="60" cy="60" r="30" fill="none" stroke="currentColor" stroke-width="0.8" />
       <use href="#note" x="40" y="38" width="40" height="40" />`,
      { class: "emblem", viewBox: "0 0 120 120" },
    ),
    h("h1", { class: "title" }, "rasisong"),
    divider(),
    h("p", { class: "tagline" }, "あなたの声と、指先のリズムと、十の問いから", h("br"), "世界にひとつ、一分の歌を。"),
    h("button", {
      class: "btn",
      onclick: async () => {
        await Tone.start(); // 音はクリックのあとでないと鳴らせないので、最初のボタンで始める
        voiceScreen();
      },
    }, "はじめる"),
    h("p", { class: "note", style: "margin-top: 26px" }, "所要 約三分　・　声はこの画面の中だけで使い、保存しません"),
  );
}

// ── I 声 ─────────────────────────────────────

function voiceScreen() {
  const ticks = Array.from({ length: 40 }, (_, i) => {
    const a = (i / 40) * Math.PI * 2;
    return `<circle cx="${105 + Math.cos(a) * 103}" cy="${105 + Math.sin(a) * 103}" r="${i % 5 ? 0.8 : 1.6}" fill="currentColor" opacity="0.6" />`;
  }).join("");
  const ring = svg(
    `<circle cx="105" cy="105" r="95" fill="none" stroke="currentColor" stroke-opacity="0.25" />
     <circle class="progress" cx="105" cy="105" r="95" fill="none" stroke="currentColor" stroke-width="2" transform="rotate(-90 105 105)" />
     ${ticks}`,
    { viewBox: "0 0 210 210" },
  );
  const progress = ring.querySelector(".progress");
  const count = h("span", { class: "count" }, String(VOICE_MS / 1000));
  const label = h("span", {}, "録音する");
  const status = h("p", { class: "note" }, "マイクの許可を求められたら「許可」を選んでください");
  const next = h("button", { class: "btn", disabled: true, onclick: tapScreen }, "次へ");
  const wave = h("canvas", { class: "wave", width: 840, height: 112 });
  const level = { value: 0.04 }; // 声の糸の揺れの大きさ（録音中だけ大きくする）

  const record = h("button", {
    onclick: async () => {
      record.disabled = true;
      label.textContent = "準備中";
      let stopCountdown = () => {};
      const voiceWav = await recordVoice(VOICE_MS, {
        onStart: () => {
          const startedAt = performance.now();
          label.textContent = "録音中";
          status.textContent = "話してください……";
          level.value = 0.6;
          stopCountdown = every(() => {
            const t = Math.min(1, (performance.now() - startedAt) / VOICE_MS);
            progress.style.strokeDashoffset = 597 * (1 - t);
            count.textContent = String(Math.ceil((VOICE_MS / 1000) * (1 - t)));
          }, 50);
        },
      });
      stopCountdown();
      level.value = 0.04;
      materials.voiceWav = voiceWav;
      if (voiceWav) {
        progress.style.strokeDashoffset = 0;
        count.textContent = "0";
        label.textContent = "受け取りました";
        status.textContent = "あなたの声を受け取りました";
        next.disabled = false;
        next.focus();
      } else {
        // マイクが使えない・何も話していない。もう一度録るか、声なしで進む
        progress.style.strokeDashoffset = 597;
        count.textContent = String(VOICE_MS / 1000);
        label.textContent = "もう一度";
        status.textContent = "声が取れませんでした。もう一度録音するか、声なしで進んでください";
        record.disabled = false;
      }
    },
  }, count, label);

  show(
    chapter("I", "声"),
    h("p", { class: "theme" }, VOICE_THEME),
    h("p", { class: "note" }, `ボタンを押すと、${KANJI[VOICE_MS / 1000 - 1]}秒間だけ録音します`),
    h("div", { class: "ring" }, ring, record),
    wave,
    status,
    next,
    h("br"),
    h("button", { class: "link", onclick: () => { materials.voiceWav = null; tapScreen(); } }, "声なしで進む"),
  );
  drawWave(wave, level);
}

// 声の糸（3本の細い線がゆらぐ）。飾りなので、実際の声の大きさは使わない
function drawWave(canvas, level) {
  const g = canvas.getContext("2d");
  let frame = 0;
  const draw = () => {
    const t = performance.now() / 1000;
    g.clearRect(0, 0, canvas.width, canvas.height);
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      g.strokeStyle = `rgba(201, 169, 106, ${0.8 - k * 0.25})`;
      g.lineWidth = k ? 1 : 1.6;
      for (let x = 0; x <= canvas.width; x += 6) {
        const env = Math.sin((x / canvas.width) * Math.PI);
        const amp = level.value * env * (0.5 + 0.5 * Math.sin(t * 3 + x * 0.013 + k));
        const y = canvas.height / 2 + Math.sin(x * 0.03 + t * (4 + k) + k * 2) * amp * canvas.height * 0.45;
        if (x) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.stroke();
    }
    frame = requestAnimationFrame(draw);
  };
  draw();
  cleanups.push(() => cancelAnimationFrame(frame));
}

// ── II 律動（叩く）───────────────────────────

function tapScreen() {
  const tapTimesMs = []; // 叩いた時刻（performance.now()）
  let endsAt = 0;
  const number = document.createTextNode("0");
  const hint = h("small", {}, "ここを叩く");
  const status = h("p", { class: "note" }, "叩いた間隔から、曲の速さとノリを決めます");
  const next = h("button", { class: "btn", disabled: true, onclick: () => quizScreen() }, "次へ");

  const pad = h("button", { class: "pad", "aria-label": "ここを叩く" },
    svg(
      `<circle cx="100" cy="100" r="96" fill="none" stroke="currentColor" stroke-opacity="0.5" />
       <circle cx="100" cy="100" r="88" fill="none" stroke="currentColor" stroke-opacity="0.2" />
       <g class="rosette">${rosette({ cx: 100, cy: 100, count: 24, size: 40, radius: 44, opacity: 0.55 })}</g>
       <circle cx="100" cy="100" r="44" fill="rgba(11,10,13,0.9)" stroke="currentColor" stroke-opacity="0.6" />`,
      { viewBox: "0 0 200 200" },
    ),
    h("span", { class: "label" }, number, hint),
  );

  const finish = () => {
    materials.tapIntervalsMs = measureTapIntervals(tapTimesMs);
    hint.textContent = "受け取りました";
    status.textContent = materials.tapIntervalsMs
      ? "あなたのリズムを受け取りました"
      : "叩いた回数が少ないので、決まった速さで作ります";
    next.disabled = false;
    next.focus();
  };

  const tap = () => {
    const now = performance.now();
    if (endsAt && now > endsAt) return; // 時間が過ぎたら受け付けない
    if (!endsAt) {
      endsAt = now + TAP_MS;
      const stop = every(() => {
        const left = (endsAt - performance.now()) / 1000;
        if (left > 0) {
          status.textContent = `残り ${left.toFixed(1)} 秒`;
          return;
        }
        stop();
        finish();
      }, 100);
    }
    tapTimesMs.push(now);
    number.textContent = String(tapTimesMs.length);
    hint.textContent = "回";
    const ripple = h("span", { class: "ripple" });
    pad.append(ripple);
    later(() => ripple.remove(), 1300);
    pad.classList.remove("hit");
    void pad.offsetWidth; // アニメーションをやり直すため
    pad.classList.add("hit");
  };

  pad.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    tap();
  });
  // キーボードでも叩ける（スペース・Enter。押しっぱなしの連打は数えない）
  pad.addEventListener("keydown", (e) => {
    if ((e.key === " " || e.key === "Enter") && !e.repeat) {
      e.preventDefault();
      tap();
    }
  });

  show(
    chapter("II", "律動"),
    h("h2", {}, "好きなリズムで、叩いてください"),
    h("p", { class: "note" }, "最初に叩いてから、十秒間"),
    pad,
    status,
    next,
    h("br"),
    h("button", { class: "link", onclick: () => { materials.tapIntervalsMs = null; quizScreen(); } }, "叩かずに進む"),
  );
}

// ── III 問い（10問。1問ずつ）─────────────────

function quizScreen(index = 0, answers = []) {
  if (index >= QUESTIONS.length) {
    materials.quiz = answers; // [{ value: 1〜5, responseMs }]
    makingScreen();
    return;
  }
  const shownAt = performance.now();
  let answered = false;
  const choices = h("div", { class: "choices" },
    CHOICES.map((label, i) =>
      h("button", {
        class: "choice",
        onclick: (e) => {
          if (answered) return; // 二度押しで2問進まないように
          answered = true;
          choices.classList.add("locked");
          e.currentTarget.classList.add("picked");
          const responseMs = Math.round(performance.now() - shownAt);
          later(() => quizScreen(index + 1, [...answers, { value: i + 1, responseMs }]), 380);
        },
      }, h("span", { class: "dot" }), label),
    ),
  );
  show(
    chapter("III", "問い"),
    h("div", { class: "beads" }, QUESTIONS.map((_, i) => h("i", { class: i <= index ? "on" : null }))),
    h("div", { class: "note" }, `第${KANJI[index]}問　／　十`),
    h("p", { class: "question" }, QUESTIONS[index].text),
    choices,
  );
}

// ── IV 紡ぐ（曲をつくる）─────────────────────

async function makingScreen() {
  const items = [h("li"), h("li"), h("li"), h("li")];
  const light = (i, text) => {
    items[i].textContent = text;
    items[i].classList.add("on");
  };
  items[0].textContent = "声から、調を選んでいます";
  items[1].textContent = "叩いた間隔から、テンポとノリを決めています";
  items[2].textContent = "十の問いから、曲の表情を描いています";
  items[3].textContent = "音を重ね、ひとつの歌にしています";

  show(
    chapter("IV", "紡ぐ"),
    svg(
      `<g class="a">${rosette({ cx: 85, cy: 85, count: 12, size: 34, radius: 30, opacity: 0.8 })}</g>
       <g class="b">${rosette({ cx: 85, cy: 85, count: 20, size: 22, radius: 62, opacity: 0.45 })}</g>
       <use href="#note" x="65" y="62" width="40" height="40" />`,
      { class: "loom", viewBox: "0 0 170 170" },
    ),
    h("h2", {}, "あなたの歌を、紡いでいます"),
    h("ul", { class: "steps" }, items),
  );

  const startedAt = performance.now();
  try {
    const { blueprint, assets } = await toBlueprint(materials);
    const s = blueprint.sources;
    light(0, s.voice ? "声の高さから、調を選びました" : "声なしで、原曲の調のまま進めます");
    await wait(500);
    light(1, s.taps ? "叩いた間隔から、テンポとノリを決めました" : "決まった速さとノリで進めます");
    await wait(500);
    light(2, s.quiz ? "十の問いから、曲の表情を描きました" : "曲の表情は、決まった形で進めます");

    const titlePromise = fetchTitle(blueprint); // 曲づくりと同時に、曲名を頼んでおく
    const score = await compose(blueprint);
    const wav = await renderSong(score, assets);
    light(3, "ひとつの歌になりました");
    const titleResult = await titlePromise;
    await wait(Math.max(0, MIN_MAKING_MS - (performance.now() - startedAt)));
    listenScreen({ wav, score, titleResult });
  } catch (error) {
    console.error("曲を作れませんでした", error);
    errorScreen(error);
  }
}

// 曲名と解説（AI）。サーバーに送るのは設計図の数字だけ。失敗・時間切れは決まった曲名にする
async function fetchTitle(blueprint) {
  try {
    const res = await fetch("/api/title", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(blueprint),
      signal: AbortSignal.timeout(TITLE_TIMEOUT_MS),
    });
    if (!res.ok) return FALLBACK_TITLE;
    const data = await res.json();
    return typeof data.title === "string" && data.title ? data : FALLBACK_TITLE;
  } catch {
    return FALLBACK_TITLE;
  }
}

function errorScreen(error) {
  show(
    chapter("IV", "紡ぐ"),
    h("h2", {}, "歌を紡げませんでした"),
    divider(),
    h("p", { class: "note" }, "曲を作る途中で問題が起きました。もう一度試すか、はじめからやり直してください。"),
    h("p", { class: "note" }, String(error?.message ?? error)),
    h("button", { class: "btn", onclick: makingScreen }, "もう一度つくる"),
    h("br"),
    h("button", { class: "link", onclick: startScreen }, "はじめから"),
  );
}

// ── V 聴く・持ち帰る ─────────────────────────

const PLAY_ICON = '<path d="M7 4l13 8-13 8z" fill="currentColor" />';
const PAUSE_ICON = '<path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor" />';

function listenScreen({ wav, score, titleResult }) {
  const url = URL.createObjectURL(wav);
  const audio = new Audio(url); // 画面で聞く曲＝持ち帰る曲（同じ WAV）
  cleanups.push(() => {
    audio.pause();
    URL.revokeObjectURL(url);
  });

  const icon = svg(PLAY_ICON, { viewBox: "0 0 24 24" });
  const fill = h("div", { class: "fill" });
  const knob = h("div", { class: "knob" });
  const now = h("span", {}, "0:00");
  const total = h("span", {}, "0:00");
  const sectionName = h("div", { class: "section-name" }, "　");
  const track = h("div", { class: "track" }, h("div", { class: "rail" }), fill, knob);

  const paint = () => {
    const duration = audio.duration || score.duration || 1;
    const p = Math.min(1, audio.currentTime / duration);
    fill.style.width = `${p * 100}%`;
    knob.style.left = `${p * 100}%`;
    now.textContent = clock(audio.currentTime);
    total.textContent = clock(duration);
    sectionName.textContent = audio.currentTime > 0 ? sectionLabel(score.structure, audio.currentTime) : "　";
    icon.innerHTML = audio.paused ? PLAY_ICON : PAUSE_ICON;
  };
  audio.addEventListener("timeupdate", paint);
  audio.addEventListener("play", paint);
  audio.addEventListener("pause", paint);
  audio.addEventListener("ended", paint);
  audio.addEventListener("loadedmetadata", () => {
    // 区間の切れ目に目盛りを打つ
    for (const part of score.structure ?? []) {
      if (part.start > 0) track.append(h("div", { class: "tick", style: `left: ${(part.start / audio.duration) * 100}%` }));
    }
    paint();
  });
  track.addEventListener("click", (e) => {
    const rect = track.getBoundingClientRect();
    if (audio.duration) audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
  });

  const filename = downloadName(new Date());
  show(
    chapter("V", "聴く"),
    h("p", { class: "song-title" }, titleResult.title),
    h("p", { class: "song-comment" }, titleResult.comment ?? ""),
    divider(),
    h("div", { class: "player" },
      h("button", { class: "play", "aria-label": "再生・一時停止", onclick: () => (audio.paused ? audio.play() : audio.pause()) }, icon),
      sectionName,
      track,
      h("div", { class: "times" }, now, total),
    ),
    h("a", { class: "btn", href: url, download: filename }, "持ち帰る（WAV）"),
    h("p", { class: "file" }, filename),
    h("button", { class: "link", onclick: startScreen }, "はじめから"),
  );
}

// 今いる区間の名前（score.structure の name: "intro" | "q1"…"q10" | "outro"）
function sectionLabel(structure = [], time) {
  const part = structure.find((p) => time >= p.start && time < p.end) ?? structure.at(-1);
  if (!part) return "　";
  if (part.name === "intro") return "イントロ　あなたの声";
  if (part.name === "outro") return "アウトロ　あなたの声";
  const n = Number(part.name.slice(1));
  return Number.isInteger(n) && n >= 1 && n <= 10 ? `第${KANJI[n - 1]}問` : "　";
}

function clock(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// 保存するファイル名 rashisa-YYYYMMDD-HHMM.wav（名前など個人の情報は入れない）
function downloadName(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `rashisa-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.wav`;
}

startScreen();
