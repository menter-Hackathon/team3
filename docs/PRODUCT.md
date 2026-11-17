# プロダクト情報

> このファイルはチームで自由に編集します（変更は PR で共有）。CLAUDE.md から読み込まれます。
> 今の内容はたたき台です。作品の詳しい説明はチームの Notion ページにあります。

## 概要

- テーマ: らしさ
- プロダクト名: 未定
- 内容: 体験した人の声・叩き方・質問への答えから、その人だけの1分の曲をつくる。Apple Watch やカメラで測れる人は、心拍や表情も曲に入れる
- 最低限の完成形: 声・叩き方・10問 → 1分の曲 → 音声ファイル（WAV）で持ち帰り
- 優先順位: まず音楽。映像はそのあと

## 体験の流れ（約3分）

1. 名前や好きな言葉をマイクに向かって話す（5秒）
2. 画面を好きなリズムで叩く（10秒）
3. 10個の質問（TIPI-J）に答える（約1分）
4. その人だけの曲が流れる（約1分）。最初と最後に本人の声がそのまま聞こえる
5. 曲をファイルで持ち帰る

## 技術スタック

- 画面: HTML・CSS・JavaScript（Mac の Chrome で動かす）。Vite 8 で開発・ビルド
- 音: Tone.js 15（声の楽器化は GrainPlayer、書き出しは Tone.Offline → WAV）。DAW は使わない
- 映像: p5.js 2（使うときだけ読み込む）
- 表情・輪郭: MediaPipe Face Landmarker（@mediapipe/tasks-vision）
- 心拍: Apple Watch・iPhone アプリ（Swift、HealthKit、WatchConnectivity）→ WebSocket で中継（未着手）
- AI: Claude API（@anthropic-ai/sdk、曲名と解説だけ）。Worker の中だけで呼ぶ。モデルは `worker/index.js` の `MODEL`
- サーバー・配信: Cloudflare Workers（wrangler 4、@cloudflare/vite-plugin）。R2・Durable Objects は必要になったら

## 設計の決まりごと

- 材料（入力）と曲の受け渡しは「曲の設計図」（JSON）だけにする。入力側は設計図を作るところまで、曲側は設計図を受け取るところから
- どの材料が取れなくても曲は作れるようにする（心拍・カメラ・ネットは任意）
- 体験者の声・顔・心拍は個人情報。ブラウザの中だけで使い、保存しない。リポジトリにも入れない
- 顔の画像や映像を AI や外部サービスに送らない
- 顔の形から性格を判定しない。「○○タイプ」のようなタイプ分けはしない

## 役割（案）

- UI: 画面の見た目と流れ。最後にみんなの部品をつなぐ
- 曲1（骨組み）: 設計図から、曲の構成・和音・メロディ・リズム・テンポを決めて鳴らす
- 曲2（音色と書き出し）: 声を楽器の音にする、楽器の音・エフェクト・音量をそろえる処理、WAV への書き出し
- 入力1: 録音した声・叩いたリズム・質問の答えと回答時間を、設計図の数字にする
- 入力2: センサー（Apple Watch の心拍、MediaPipe の表情・輪郭）

## 曲の設計図（例。形は未確定）

形・既定値・見本は `src/blueprint.js`。形を変えるときは、このファイルと同じ PR で直す。

```json
{
  "version": 1,
  "bpm": 78,
  "root": "D",
  "scale": "dorian",
  "density": 0.7,
  "groove": [0, 0.03, -0.02, 0.05],
  "voice": true,
  "timbre": [1, 0.4, 0.25, 0.1],
  "sections": [
    { "q": 1, "energy": 0.3, "brightness": 0.5, "hesitation": 0.1 },
    { "q": 2, "energy": 0.8, "brightness": 0.6, "hesitation": 0.0 }
  ]
}
```

- version: 設計図の形の版
- bpm: 叩いた速さから決める。心拍があれば心拍に寄せる（60〜160）
- root / scale / density: 性格診断から決める（キー・音階・音の多さ）。scale は暗い順に phrygian・aeolian・dorian・mixolydian・ionian・lydian
- groove: 叩いたリズムのズレ。4拍それぞれを何秒前後にずらすか（±0.05）
- voice: 録音した声があるか。声そのものは設計図に入れず、AudioBuffer のまま曲側に渡す
- timbre: 輪郭から作った倍音の強さ（輪郭がなければ決まった音色）
- sections: 1問ごとの盛り上がり・明るさ・迷い（0〜1）
- 曲の構成: イントロ2小節（声）→ 1問＝2小節 × 10 → アウトロ2小節（声）。80 BPM で約74秒

## セットアップ・起動・テスト

- 必要なもの: Node.js 24（`.nvmrc`）、Chrome
- 初回: `npm install`
- 起動: `npm run dev` → `http://localhost:5173`（画面と `/api` が両方動く）
- 曲だけ試す: 最初の画面の「見本の設計図で曲だけつくる（開発用）」
- AI を試す: `cp .dev.vars.example .dev.vars` してキーを入れる。なくても動く（曲名が「あなたの曲」になる）
- 心拍を試す: `http://localhost:5173/?heart=wss://...`（中継の URL を渡す）
- ビルド確認: `npm run build`
- 公開（チームで相談してから）: `npm run build && npx wrangler deploy`（初回は `npx wrangler login`）
- テスト: 自動テストはまだない。音・カメラ・マイクはブラウザで実際に鳴らして確かめる

## ディレクトリ構成

流れ: 材料 → `toBlueprint()` → 設計図 → `compose()` → 楽譜 → `renderSong()` → WAV

```
index.html              画面の入口（UI）
src/main.js             画面の流れ。各担当の部品をつなぐ（UI）
src/style.css           見た目（UI）
src/blueprint.js        曲の設計図の形・既定値・見本（全員。変えるときは相談）
src/util.js             共通の小さな関数
src/input/              入力1: voice.js（声）・tap.js（叩く）・quiz.js（10問）・toBlueprint.js（材料 → 設計図）
src/sensor/             入力2: heart.js（心拍）・face.js（顔の輪郭 → 音色）
src/music/compose.js    曲1: 設計図 → 楽譜（構成・和音・メロディ・リズム）
src/music/sound.js      曲2: 楽器・音色・エフェクト・音量
src/music/render.js     曲2: 楽譜 → WAV（Tone.Offline）。wav.js が WAV 形式に変換
src/visual/sketch.js    映像（p5.js）
worker/index.js         サーバー（Cloudflare Worker）: /api/title（AI で曲名）・/api/health
wrangler.jsonc          Cloudflare の設定
```

- 各ファイルの先頭に【担当】と、やること（TODO）を書いてある
- Apple Watch・iPhone アプリは、作るときに `watch/` に Xcode のプロジェクトを置く予定
