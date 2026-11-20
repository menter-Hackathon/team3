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
//     detector    瞬きの見つけ方（しきい値は detector.options で変えられる）
//     stop()      カメラを止める
//   }
//   カメラが使えない・モデルを読み込めないときは、例外を投げずに null を返す
//
// summarizeBlinks(timesMs, startMs, endMs) → { timesMs, count, perMinute }  材料（blinks）の形にまとめる
// createBlinkDetector(options) → { update(score, nowMs) → 瞬きの始まりの時刻の配列, reset(), options }  目の閉じ具合から瞬きを見つける

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// しきい値はメガネや照明で変わる。合わないときは startBlinks() が返す tracker.detector.options（または createBlinkDetector の引数）で変えられる
// 実際の顔で試した値（2026-11-20）：瞬きの山は 0.5〜0.77、ふだんは 0.1 前後、目線だけ下をちらっと見ると 0.33 まで
export const BLINK_DEFAULTS = {
  closeAbove: 0.5, // 閉じ具合がこれを超えたら「閉じた」
  openBelow: 0.3, // これを下回ったら「開いた」（2つの値を分けて、境目でのばたつきを防ぐ）
  minClosedMs: 60, // これより短い閉じは読み取りのぶれとして捨てる（1コマだけ跳ねた値。速い瞬きでも2コマは続く）
  maxClosedMs: 500, // 1回の瞬きとして数える長さの上限（自然な瞬きは 0.1〜0.4 秒）
  maxClosureMs: 1200, // 閉じていた全体がこれより長ければ、中の瞬きも数えない（目を閉じていた・下を見続けていた）
  valleyDrop: 0.06, // 閉じている途中で、閉じ具合がこれだけ下がり（開きかけ。実際の2回まばたきの谷は 0.07〜0.33、閉じたままのゆれは 0.03 まで）
  valleyRise: 0.05, // そこからまたこれだけ上がったら（閉じ直し）、2回目の瞬きとみなす。すばやい2回まばたきは開ききらないため
};

// 目の閉じ具合（0〜1）を1コマずつ渡すと、目が開いたコマで、そのあいだの瞬きの始まりの時刻を配列で返す（ふつうは空の配列）
export function createBlinkDetector(options = {}) {
  const opts = { ...BLINK_DEFAULTS, ...options };
  let closure = null; // 閉じているあいだの記録 { starts: 瞬きの始まりの時刻, peak, valley, valleyAt }
  return {
    options: opts,
    update(score, nowMs) {
      if (closure === null) {
        if (score > opts.closeAbove) closure = { starts: [nowMs], peak: score, valley: null, valleyAt: 0 };
        return [];
      }
      if (score < opts.openBelow) {
        // 開いた。区切った瞬きを1つずつ、長さで確かめる
        const { starts } = closure;
        closure = null;
        if (nowMs - starts[0] > opts.maxClosureMs) return [];
        const ends = [...starts.slice(1), nowMs];
        const lengths = starts.map((start, i) => ends[i] - start);
        // 長すぎる部分が1つでもあれば、全体を「目を閉じていた・下を見ていた」とみなす（閉じたまま少し開きかけた所で区切れてしまうため）
        if (lengths.some((ms) => ms > opts.maxClosedMs)) return [];
        return starts.filter((_, i) => lengths[i] >= opts.minClosedMs);
      }
      // 閉じているあいだ：開きかけて、また閉じたら、開きかけた所で区切る
      if (closure.valley === null) {
        if (score > closure.peak) closure.peak = score;
        else if (closure.peak - score >= opts.valleyDrop) {
          closure.valley = score;
          closure.valleyAt = nowMs;
        }
      } else if (score < closure.valley) {
        closure.valley = score;
        closure.valleyAt = nowMs;
      } else if (score - closure.valley >= opts.valleyRise) {
        closure.starts.push(closure.valleyAt);
        closure.peak = score;
        closure.valley = null;
      }
      return [];
    },
    reset() {
      closure = null;
    },
  };
}

// startMs〜endMs の間の瞬きを、材料の形にまとめる
export function summarizeBlinks(timesMs, startMs, endMs) {
  const inRange = timesMs.filter((t) => t >= startMs && t <= endMs);
  const minutes = (endMs - startMs) / 60000;
  return {
    timesMs: inRange,
    count: inRange.length,
    perMinute: minutes > 0 ? Math.round((inRange.length / minutes) * 10) / 10 : 0,
  };
}

export async function startBlinks({ video = document.createElement("video"), onBlink } = {}) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: 640, height: 480 },
      audio: false,
    });
  } catch (error) {
    console.warn("カメラが使えませんでした", error);
    return null;
  }

  let landmarker;
  try {
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
    landmarker = await create("GPU").catch(() => create("CPU")); // GPU が使えない環境では CPU で動かす

    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
  } catch (error) {
    console.warn("瞬きの読み取りを始められませんでした", error);
    stream.getTracks().forEach((track) => track.stop());
    landmarker?.close();
    return null;
  }

  const detector = createBlinkDetector();
  const timesMs = [];
  let score = 0;
  let faceVisible = false;
  let frames = 0;
  let running = true;
  let lastVideoTime = -1;
  let frameId = 0;

  // カメラの新しいコマが来たときだけ読む。requestVideoFrameCallback はコマごとに呼ばれる
  // （requestAnimationFrame だと画面の書き換えごと、120Hz の画面なら同じコマを4回読んでしまう）
  const byFrame = "requestVideoFrameCallback" in video;
  const schedule = () => {
    frameId = byFrame ? video.requestVideoFrameCallback(loop) : requestAnimationFrame(loop);
  };

  const read = () => {
    const now = performance.now();
    let shapes;
    try {
      shapes = landmarker.detectForVideo(video, now).faceBlendshapes?.[0]?.categories;
    } catch (error) {
      // 1コマ読み取れなくても止めない
      console.warn("瞬きの読み取りに失敗しました（このコマは飛ばします）", error);
      return;
    }
    frames += 1;
    if (!shapes) {
      faceVisible = false;
      score = 0;
      detector.reset(); // 顔が見えなくなったら、途中の瞬きは数えない
      return;
    }
    const value = (name) => shapes.find((c) => c.categoryName === name)?.score ?? 0;
    faceVisible = true;
    score = (value("eyeBlinkLeft") + value("eyeBlinkRight")) / 2;
    for (const at of detector.update(score, now)) {
      timesMs.push(at);
      onBlink?.(at);
    }
  };

  const loop = () => {
    if (!running) return;
    if (video.readyState >= 2 && (byFrame || video.currentTime !== lastVideoTime)) {
      lastVideoTime = video.currentTime;
      read();
    }
    schedule();
  };
  schedule();

  return {
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
}
