// 【入力2】心拍（任意）。Apple Watch → iPhone → 中継サーバー → ここ（WebSocket で受け取る）。
//
// 書くもの:
//   connectHeart(url) → { bpm（今の心拍。まだ届いていなければ null）, close() }、URL がないときは null
//
// 参考:
//   中継の URL は ?heart=wss://... のように画面の URL で渡す:
//     const url = new URLSearchParams(location.search).get("heart");
//   const socket = new WebSocket(url);
//   socket.addEventListener("message", (e) => { const { bpm } = JSON.parse(e.data); … });
//   届く形は {"bpm":72}（iPhone アプリが送る形と同じ）
//   数秒おきにしか届かず値もぶれるので、直近いくつかの中央値を使うとよい

export function connectHeart(url) {
  // TODO(入力2)
  return null;
}
