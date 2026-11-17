// 【入力2】心拍（任意）。Apple Watch → iPhone → 中継（/api/heart）→ ここ（WebSocket で受け取る）。
// 受け渡しの形は docs/interfaces.md の「4. 材料」「8. サーバー・アプリとのやり取り」。
//
// 書くもの:
//   connectHeart(url) → { bpm: 今の値 | null（まだ届いていなければ null）, close() } | null
//     心拍を使わないとき・つなげないときは、例外を投げずに null を返す
//     材料として渡すときは、UI がその時点の値を { bpm } にして渡す
//
// 参考:
//   中継は同じサイトの /api/heart。受け取る側は role=listen でつなぐ:
//     const url = `${location.origin.replace(/^http/, "ws")}/api/heart?role=listen`;
//   心拍を使うかどうかは、画面の URL に ?heart を付けたときだけ、などで切り替える
//   const socket = new WebSocket(url);
//   socket.addEventListener("message", (e) => { const { bpm } = JSON.parse(e.data); … });
//   届く形は {"bpm":72}（30〜220 の整数）。知らないキーは無視する
//   数秒おきにしか届かず値もぶれるので、直近いくつかの中央値を使うとよい

export function connectHeart(url) {
  // TODO(入力2)
  return null;
}
