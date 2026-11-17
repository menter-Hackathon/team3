// 【入力2】顔（任意）。MediaPipe Face Landmarker（@mediapipe/tasks-vision）で輪郭を取り、
// 形をそのまま音色（倍音の強さ = 設計図の timbre）にする。
// 顔の画像は保存しない・外部に送らない。顔の形から性格は判定しない。
//
// TODO(入力2): カメラ → Face Landmarker → 輪郭（FACE_OVAL）の点
//   → 中心からの距離を角度順に並べてフーリエ変換 → 1〜8 番目の強さを 0〜1 にそろえる
//   → { timbre: [1, 0.4, ...] } を返す。取れなかったら null

export async function captureFace() {
  return null;
}
