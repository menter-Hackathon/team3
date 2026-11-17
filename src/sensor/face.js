// 【入力2】顔（任意）。MediaPipe Face Landmarker で顔の輪郭を取り、形をそのまま音色（設計図の timbre）にする。
// 顔の画像は保存しない・外部に送らない。顔の形から性格は判定しない。
//
// 書くもの:
//   captureFace() → { timbre: [1, 0.4, …] }（倍音の強さ 0〜1）、取れなかったら null
//
// 参考（MediaPipe）:
//   import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
//   const fileset = await FilesetResolver.forVisionTasks(
//     "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm");
//   const landmarker = await FaceLandmarker.createFromOptions(fileset, {
//     baseOptions: { modelAssetPath:
//       "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" },
//     runningMode: "VIDEO",
//   });
//   // カメラ: video.srcObject = await navigator.mediaDevices.getUserMedia({ video: true })
//   const result = landmarker.detectForVideo(video, performance.now());
//   result.faceLandmarks[0] が顔の 478 点。輪郭の点の番号は FaceLandmarker.FACE_LANDMARKS_FACE_OVAL
//
// 参考（輪郭 → 音色）:
//   輪郭の中心からの距離を角度の順に並べ、フーリエ変換して 1〜8 番目の強さを取り、0〜1 にそろえる

export async function captureFace() {
  // TODO(入力2)
  return null;
}
