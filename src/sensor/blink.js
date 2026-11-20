// 【センサー（任意）】瞬き。カメラの映像から MediaPipe Face Landmarker で目の閉じ具合を読み、瞬きした時刻を記録する。
// カメラの映像は保存しない・外部に送らない。このファイルの外に出すのは瞬きの時刻（数字）だけ。
// 瞬きの多さを「緊張している」などと解釈しない（性格・気持ちの判定には使わない）。
// 受け渡しの形は docs/interfaces.md の「4. 材料」。
//
// startBlinks({ video, onBlink }) → Promise<BlinkTracker | null>
//   BlinkTracker = {
//     timesMs     瞬きした時刻の配列（目を閉じ始めた時刻、performance.now() のミリ秒）
//     score       今の目の閉じ具合（0〜1、両目の平均）
//     faceVisible 顔が見えているか
//     frames      処理したコマ数（動いているかの確認用）
//     detector    瞬きの見つけ方（しきい値は detector.options の中を書き換えると変わる）
//     video       使っている video 要素
//     summarize(startMs, endMs) → Blinks | null   材料（blinks）の形にまとめる。顔が映っていた時間が半分未満なら null
//     stop()      カメラを止める（2回呼んでもよい）
//   }
//   カメラが使えない・モデルを読み込めない（20秒で打ち切り）ときは、例外を投げずに null を返す
//   モデルを読み込んでからカメラを開く（読み込みが止まっても、カメラが付いたままにならないように）
//
// summarizeBlinks(timesMs, startMs, endMs) → { timesMs, count, perMinute }  時刻の配列を数えるだけ（顔が映っていたかは見ない）
// createBlinkDetector(options) → { update(score, nowMs) → 瞬きの始まりの時刻の配列, reset(), options }  目の閉じ具合から瞬きを見つける

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm"; // package.json の版と合わせる
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const LOAD_TIMEOUT_MS = 20000; // モデルの読み込みをあきらめるまでの時間
const MAX_FAILED_FRAMES = 60; // 読み取りの失敗がこれだけ続いたら止める（約2秒）
const MIN_FACE_RATIO = 0.5; // summarize で、顔が映っていた時間がこれより少なければ null

// しきい値はメガネや照明で変わる。合わないときは tracker.detector.options（または createBlinkDetector の引数）で変える
// 実際の顔で試した値（2026-11-20、1人）：瞬きの山は 0.47〜0.80、ふだんは 0.1 前後、目線だけ下をちらっと見ると 0.33 まで、
//   2回まばたきの開きかけの谷は 0.10〜0.33 下がる、目を閉じたままのゆれは 0.03 まで
export const BLINK_DEFAULTS = {
  closeAbove: 0.45, // 閉じ具合がこれを超えたら「閉じた」
  openBelow: 0.3, // これを下回ったら「開いた」（2つの値を分けて、境目でのばたつきを防ぐ）
  settleMs: 300, // closeAbove より下（0.3〜0.45）にこれだけとどまっても「開いた」とみなす（下を見ていて 0.3 まで下がらないとき）
  minClosedFrames: 2, // 閉じていたコマがこれより少ないものは読み取りのぶれとして捨てる（1コマだけ跳ねた値）
  minClosedMs: 50, // これより短いものも捨てる（同じコマを何度も読む環境向け）
  maxClosedMs: 500, // 1回の瞬きとして数える長さの上限（自然な瞬きは 0.1〜0.4 秒）
  maxClosureMs: 1200, // 閉じていた全体がこれより長ければ、中の瞬きも数えない（目を閉じていた・下を見続けていた）
  valleyDrop: 0.08, // 閉じている途中で、閉じ具合がこれだけ下がり（開きかけ）
  valleyRise: 0.06, // そこからまたこれだけ上がって closeAbove を超え直したら（閉じ直し）、2回目の瞬きとみなす
};

// 目の閉じ具合（0〜1）を1コマずつ渡すと、目が開いたコマで、そのあいだの瞬きの始まりの時刻を配列で返す（ふつうは空の配列）
export function createBlinkDetector(options = {}) {
  const opts = { ...BLINK_DEFAULTS, ...options };
  // 閉じているあいだの記録。parts は区切った瞬き（start: 始まりの時刻、frames: コマ数）
  let closure = null;

  // 閉じていたあいだを、endMs で開いたとして締めくくる
  const finish = (endMs) => {
    const { parts } = closure;
    closure = null;
    if (endMs - parts[0].start > opts.maxClosureMs) return [];
    const lengths = parts.map((part, i) => (i + 1 < parts.length ? parts[i + 1].start : endMs) - part.start);
    // 長すぎる部分が1つでもあれば、全体を「目を閉じていた・下を見ていた」とみなす（閉じたまま少し開きかけた所で区切れてしまうため）
    if (lengths.some((ms) => ms > opts.maxClosedMs)) return [];
    return parts.filter((part, i) => part.frames >= opts.minClosedFrames && lengths[i] >= opts.minClosedMs).map((part) => part.start);
  };

  return {
    options: opts,
    update(score, nowMs) {
      if (closure === null) {
        if (score > opts.closeAbove) {
          closure = { parts: [{ start: nowMs, frames: 1 }], peak: score, valley: null, valleyAt: 0, sinceValley: 0, belowSince: null };
        }
        return [];
      }
      if (score < opts.openBelow) return finish(nowMs);

      // closeAbove より下にしばらくとどまったら、下がり始めた時刻で開いたとみなす
      if (score > opts.closeAbove) closure.belowSince = null;
      else {
        closure.belowSince ??= nowMs;
        if (nowMs - closure.belowSince >= opts.settleMs) return finish(closure.belowSince);
      }

      const part = closure.parts[closure.parts.length - 1];
      part.frames += 1;
      // 開きかけて、また閉じたら、開きかけた所（谷）で区切る
      if (closure.valley === null) {
        if (score > closure.peak) closure.peak = score;
        else if (closure.peak - score >= opts.valleyDrop) {
          closure.valley = score;
          closure.valleyAt = nowMs;
          closure.sinceValley = 1;
        }
      } else {
        closure.sinceValley += 1;
        if (score < closure.valley) {
          closure.valley = score;
          closure.valleyAt = nowMs;
          closure.sinceValley = 1;
        } else if (score > opts.closeAbove && score - closure.valley >= opts.valleyRise) {
          part.frames -= closure.sinceValley;
          closure.parts.push({ start: closure.valleyAt, frames: closure.sinceValley });
          closure.peak = score;
          closure.valley = null;
        }
      }
      return [];
    },
    reset() {
      closure = null;
    },
  };
}

// startMs〜endMs の間の瞬きを数える
export function summarizeBlinks(timesMs, startMs, endMs) {
  const inRange = timesMs.filter((t) => t >= startMs && t <= endMs);
  const minutes = (endMs - startMs) / 60000;
  return {
    timesMs: inRange,
    count: inRange.length,
    perMinute: minutes > 0 ? Math.round((inRange.length / minutes) * 10) / 10 : 0,
  };
}

// 時間内に終わらなければ失敗にする。あとから終わったものは onLate で片付ける
function withTimeout(promise, ms, onLate) {
  let timedOut = false;
  promise.then((value) => timedOut && onLate?.(value), () => {});
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => {
        timedOut = true;
        reject(new Error(`${ms / 1000}秒たっても読み込めませんでした`));
      }, ms),
    ),
  ]);
}

async function loadLandmarker() {
  // MediaPipe は大きいので、使うときだけ読み込む
  const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  const create = (delegate) =>
    FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
    });
  return create("GPU").catch(() => create("CPU")); // GPU が使えない環境では CPU で動かす
}

export async function startBlinks({ video = document.createElement("video"), onBlink } = {}) {
  let landmarker;
  try {
    landmarker = await withTimeout(loadLandmarker(), LOAD_TIMEOUT_MS, (late) => late?.close());
  } catch (error) {
    console.warn("瞬きのモデルを読み込めませんでした", error);
    return null;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: 640, height: 480 },
      audio: false,
    });
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
  } catch (error) {
    console.warn("カメラが使えませんでした", error);
    stream?.getTracks().forEach((track) => track.stop());
    landmarker.close();
    return null;
  }

  const detector = createBlinkDetector();
  const timesMs = [];
  const faceSpans = []; // 顔が映っていたあいだ [始まり, 終わり]（summarize で使う）
  let score = 0;
  let faceVisible = false;
  let frames = 0;
  let failedFrames = 0;
  let running = true;
  let lastVideoTime = -1;
  let frameId = 0;

  // カメラの新しいコマが来たときだけ読む。requestVideoFrameCallback はコマごとに呼ばれる
  // （requestAnimationFrame だと画面の書き換えごと、120Hz の画面なら同じコマを4回読んでしまう）
  const byFrame = "requestVideoFrameCallback" in video;
  const schedule = () => {
    frameId = byFrame ? video.requestVideoFrameCallback(loop) : requestAnimationFrame(loop);
  };

  const lostFace = () => {
    faceVisible = false;
    score = 0;
    detector.reset(); // 顔が見えなくなったら、途中の瞬きは数えない
  };

  const read = () => {
    const now = performance.now();
    let shapes;
    try {
      shapes = landmarker.detectForVideo(video, now).faceBlendshapes?.[0]?.categories;
      failedFrames = 0;
    } catch (error) {
      // 1コマ読み取れなくても止めない。続けて失敗するときは止める
      failedFrames += 1;
      if (failedFrames === 1) console.warn("瞬きの読み取りに失敗しました（このコマは飛ばします）", error);
      lostFace();
      if (failedFrames >= MAX_FAILED_FRAMES) {
        console.warn("瞬きの読み取りが続けて失敗したので止めます");
        tracker.stop();
      }
      return;
    }
    frames += 1;
    if (!shapes) {
      lostFace();
      return;
    }
    const value = (name) => shapes.find((c) => c.categoryName === name)?.score ?? 0;
    const last = faceSpans[faceSpans.length - 1];
    if (faceVisible && last) last[1] = now;
    else faceSpans.push([now, now]);
    faceVisible = true;
    score = (value("eyeBlinkLeft") + value("eyeBlinkRight")) / 2;
    for (const at of detector.update(score, now)) {
      timesMs.push(at);
      try {
        onBlink?.(at);
      } catch (error) {
        console.warn("onBlink でエラーが起きました（読み取りは続けます）", error);
      }
    }
  };

  const loop = () => {
    if (!running) return;
    schedule(); // 先に次を予約する（読み取りで何が起きても止まらないように）
    if (video.readyState >= 2 && (byFrame || video.currentTime !== lastVideoTime)) {
      lastVideoTime = video.currentTime;
      read();
    }
  };
  schedule();

  // startMs〜endMs のうち、顔が映っていた割合
  const faceRatio = (startMs, endMs) => {
    if (!(endMs > startMs)) return 0;
    const seen = faceSpans.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(b, endMs) - Math.max(a, startMs)), 0);
    return seen / (endMs - startMs);
  };

  const tracker = {
    video,
    detector,
    get timesMs() {
      return [...timesMs];
    },
    get score() {
      return score;
    },
    get faceVisible() {
      return faceVisible;
    },
    get frames() {
      return frames;
    },
    summarize(startMs, endMs) {
      return faceRatio(startMs, endMs) >= MIN_FACE_RATIO ? summarizeBlinks(timesMs, startMs, endMs) : null;
    },
    stop() {
      if (!running) return; // 2回呼ばれても大丈夫にする
      running = false;
      if (byFrame) video.cancelVideoFrameCallback(frameId);
      else cancelAnimationFrame(frameId);
      stream.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
      landmarker.close();
    },
  };
  return tracker;
}
