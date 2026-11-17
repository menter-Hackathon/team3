// 【入力2】心拍（任意）。Apple Watch → iPhone → 中継サーバー → ここ（WebSocket）。
// 中継の URL は ?heart=wss://... のように URL で渡す。なければ心拍なしで進む。
// 届くメッセージの形: { "bpm": 72 }
// TODO(入力2): 中継サーバー（Durable Objects か Mac の Node）と Watch・iPhone アプリ
import { median } from "../util.js";

export function connectHeart(url = new URLSearchParams(location.search).get("heart")) {
  if (!url) return null;

  const samples = [];
  const socket = new WebSocket(url);
  socket.addEventListener("message", (e) => {
    try {
      const { bpm } = JSON.parse(e.data);
      if (typeof bpm === "number" && bpm > 30 && bpm < 220) samples.push(bpm);
    } catch {
      // 形の違うメッセージは無視する
    }
  });

  return {
    // 直近10個の中央値。まだ届いていなければ null
    get bpm() {
      return samples.length ? median(samples.slice(-10)) : null;
    },
    close() {
      socket.close();
    },
  };
}
