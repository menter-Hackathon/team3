// 【UI】画面の流れ。各担当の部品（input/・sensor/・music/・visual/）をここでつなぐ。
// 受け渡しの形は docs/interfaces.md（部品を呼ぶ順番を決めるのは UI だけ）。
//
// 書くもの:
//   はじめる → 声 → 叩く → 10問 → 曲をつくる → 聞く・持ち帰る、の各画面
//
// 参考（部品のつなぎ方）:
//   await Tone.start();                       // 音はクリックのあとでないと鳴らせない。最初のボタンで呼ぶ
//   const heartConnection = connectHeart(url); // 心拍（任意。null のこともある）
//   const voiceWav = await recordVoice(5000); // 声の WAV（Blob。null のこともある）
//   const tapIntervalsMs = …;                 // 叩いた間隔（ミリ秒）の配列。pointerdown の時刻の差（4回未満なら null）
//   const quiz = [{ value, responseMs }, …];  // 10問の答え（1〜5）と、質問を出してから答えるまでの時間
//   const face = await captureFace();         // 顔（任意）
//   const heart = heartConnection?.bpm != null ? { bpm: heartConnection.bpm } : null;
//   const materials = { voiceWav, tapIntervalsMs, quiz, heart, face };
//   const { blueprint, assets } = await toBlueprint(materials); // 出力: 材料 → 設計図と声の音
//   const score = await compose(blueprint);
//   const wav = await renderSong(score, assets);  // 失敗したらエラー画面
//   const url = URL.createObjectURL(wav);     // <audio src> で再生、<a href download="rashisa-YYYYMMDD-HHMM.wav"> で保存
//   const titleResult = await (await fetch("/api/title", { method: "POST", body: JSON.stringify(blueprint) })).json();
//     → { title, comment, ai }
//   映像: drawVisual(container, { blueprint, score, audio })   // audio は再生中の <audio>
//   入力ができる前は、SAMPLE_BLUEPRINT（src/blueprint.js）で曲を作って試せる
import "./style.css";

document.querySelector("#app").textContent = "ここに画面を作る（src/main.js）";
