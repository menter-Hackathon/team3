// 【入力2】心拍の中継（Cloudflare Durable Objects）。
// iPhone アプリ（送る側）から届いた {"bpm":72} を、つながっているブラウザ（受け取る側）全部に配る。
// 同じ「部屋」（?room=、なければ default）につないだ人どうしだけでやり取りする。
//
// つなぎ方（WebSocket）:
//   iPhone:   wss://<サイト>/api/heart?role=send
//   ブラウザ: wss://<サイト>/api/heart?role=listen   （手元では ws://localhost:5173/...）
// 心拍は配るだけで、どこにも保存しない。
import { DurableObject } from "cloudflare:workers";

export class HeartRelay extends DurableObject {
  async fetch(request) {
    const role = new URL(request.url).searchParams.get("role") === "send" ? "send" : "listen";
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [role]);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    if (!this.ctx.getTags(ws).includes("send")) return; // 受け取る側からのメッセージは使わない

    let bpm;
    try {
      bpm = JSON.parse(message).bpm;
    } catch {
      return;
    }
    if (typeof bpm !== "number" || bpm < 30 || bpm > 220) return;

    const text = JSON.stringify({ bpm: Math.round(bpm) }); // 整数で配る（docs/interfaces.md）
    for (const listener of this.ctx.getWebSockets("listen")) {
      try {
        listener.send(text);
      } catch {
        // 切れかけの相手には送れなくてもよい
      }
    }
  }

  async webSocketClose(ws, code) {
    try {
      ws.close(code, "closed");
    } catch {
      // すでに閉じている
    }
  }
}

// /api/heart をこの中継に渡す
export function handleHeart(request, env) {
  if (request.headers.get("Upgrade") !== "websocket") {
    return Response.json({ error: "WebSocket でつないでください" }, { status: 426 });
  }
  const room = new URL(request.url).searchParams.get("room") || "default";
  if (!/^[a-z0-9-]{1,32}$/.test(room)) {
    return Response.json({ error: "room は英小文字・数字・ハイフンで書いてください" }, { status: 400 });
  }
  const stub = env.HEART_RELAY.get(env.HEART_RELAY.idFromName(room));
  return stub.fetch(request);
}
