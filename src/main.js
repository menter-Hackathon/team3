// 【UI】画面の流れ。各担当の部品（input/・sensor/・music/・visual/）をここでつなぐ。
//
// 書くもの:
//   はじめる → 声 → 叩く → 10問 → 曲をつくる → 聞く・持ち帰る、の各画面
//
// 参考（部品のつなぎ方）:
//   await Tone.start();                     // 音はクリックのあとでないと鳴らせない。最初のボタンで呼ぶ
//   const heart = connectHeart();           // 心拍（任意。null のこともある）
//   const voice = await recordVoice(5000);  // 声
//   const taps = analyzeTaps(times);        // 叩いた時刻（performance.now()）の配列から
//   const quiz = [{ value, ms }, …];        // 10問の答え（1〜7）と、答えるまでの時間
//   const face = await captureFace();       // 顔（任意）
//   const blueprint = toBlueprint({ voice, taps, quiz, heart: heart && { bpm: heart.bpm }, face });
//   const score = compose(blueprint);
//   const wav = await renderSong(score, { voice: voice?.buffer });
//   const url = URL.createObjectURL(wav);   // <audio src> で再生、<a href download="….wav"> で保存
//   曲名: await fetch("/api/title", { method: "POST", body: JSON.stringify(blueprint) })
//   入力ができる前は、SAMPLE_BLUEPRINT（src/blueprint.js）で曲を作って試せる
import "./style.css";

document.querySelector("#app").textContent = "ここに画面を作る（src/main.js）";
