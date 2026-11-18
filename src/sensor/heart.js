// 【入力2】心拍（任意）。Apple Watch → iPhone → 中継（/api/heart、worker/heartRelay.js）→ ここ（WebSocket で受け取る）。
// 受け渡しの形は docs/interfaces.md の「4. 材料」「8. サーバー・アプリとのやり取り」。
//
// connectHeart(url) → { bpm: 今の値 | null, close() } | null
//   心拍を使わないとき・URL が正しくないときは null（例外を投げない）
//   材料として渡すときは、UI がその時点の値を { bpm } にして渡す
//
// 心拍を使うかどうかは、画面の URL で決める:
//   ?heart                 同じサイトの中継（/api/heart?role=listen）につなぐ
//   ?heart&room=名前        部屋を指定してつなぐ
//   ?heart=wss://…         その URL につなぐ（role=listen を付けた URL を渡す）
import { median } from "../util.js";

const RECENT_COUNT = 10; // 直近いくつの値の中央値を使うか（数秒おきに届き、値もぶれるため）
const FRESH_MS = 15000; // これより古い値は使わない（Watch が止まったら null に戻す）
const RETRY_MS = 2000; // 切れたら、この時間のあとにつなぎ直す

export function connectHeart(url = heartUrlFromPage()) {
  if (!isWebSocketUrl(url)) return null;

  const samples = []; // { bpm, at }
  let socket = null;
  let closed = false;
  let retryTimer = null;

  const open = () => {
    if (closed) return; // つなぎ直しを待っている間に close() されたら、もうつながない
    socket = new WebSocket(url);
    socket.addEventListener("message", (e) => {
      try {
        const { bpm } = JSON.parse(e.data);
        if (!Number.isFinite(bpm) || bpm < 30 || bpm > 220) return;
        samples.push({ bpm, at: performance.now() });
        if (samples.length > RECENT_COUNT) samples.shift();
      } catch {
        // 形の違うメッセージは無視する
      }
    });
    socket.addEventListener("close", () => {
      if (!closed) retryTimer = setTimeout(open, RETRY_MS);
    });
  };
  open();

  return {
    get bpm() {
      const fresh = samples.filter((s) => performance.now() - s.at < FRESH_MS).map((s) => s.bpm);
      return fresh.length ? Math.round(median(fresh)) : null;
    },
    close() {
      closed = true;
      clearTimeout(retryTimer);
      socket?.close();
    },
  };
}

// 画面の URL（?heart）から、つなぐ先を決める。心拍を使わないときは null
function heartUrlFromPage() {
  if (typeof location === "undefined") return null;
  const params = new URLSearchParams(location.search);
  if (!params.has("heart")) return null;
  const given = params.get("heart");
  if (given) return given;
  const room = params.get("room");
  const base = `${location.origin.replace(/^http/, "ws")}/api/heart?role=listen`;
  return room ? `${base}&room=${encodeURIComponent(room)}` : base;
}

function isWebSocketUrl(url) {
  try {
    return ["ws:", "wss:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}
