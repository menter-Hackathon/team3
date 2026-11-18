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
- 心拍: Apple Watch・iPhone アプリ（Swift、HealthKit、WatchConnectivity、XcodeGen）→ WebSocket → 中継（Durable Objects）→ ブラウザ
- AI: Claude API（@anthropic-ai/sdk、曲名と解説だけ）。Worker の中だけで呼ぶ。モデルは `worker/index.js` で決める
- サーバー・配信: Cloudflare Workers（wrangler 4、@cloudflare/vite-plugin）。R2・Durable Objects は必要になったら

## 設計の決まりごと

- **部品どうしの受け渡し（名前・単位・形・欠けたとき）は `docs/interfaces.md` に従う。受け渡しに関わるコードを書く・変える前に必ず読む**
- 材料（入力）と曲の受け渡しは「曲の設計図」（JSON）だけにする。入力側は設計図を作るところまで、曲側は設計図を受け取るところから
- どの材料が取れなくても曲は作れるようにする（心拍・カメラ・ネットは任意）
- 体験者の声・顔・心拍は個人情報。保存しない。リポジトリにも入れない。声と顔はブラウザの外に出さない（心拍は中継を通るが、配るだけで保存しない）
- 顔の画像や映像を AI や外部サービスに送らない
- 顔の形から性格を判定しない。「○○タイプ」のようなタイプ分けはしない

## 役割（案）

- UI: 画面の見た目と流れ。最後にみんなの部品をつなぐ
- 曲1（骨組み）: 設計図から、曲の構成・和音・メロディ・リズム・テンポを決めて鳴らす
- 曲2（音色と書き出し）: 声を楽器の音にする、楽器の音・エフェクト・音量をそろえる処理、WAV への書き出し
- 入力1: 録音した声・叩いたリズム・質問の答えと回答時間を、設計図の数字にする
- 入力2: センサー（Apple Watch の心拍、MediaPipe の表情・輪郭）

## 曲の設計図

- 入力と曲の境目で渡す JSON。項目は `bpm`・`root`・`scale`・`density`・`groove`・`timbre`・`sections`（10問ぶん）・`sources`（どの材料が取れたか）
- 形・範囲・例は `docs/interfaces.md` の「5. 設計図」、既定値と見本は `src/blueprint.js`
- 曲の構成: イントロ2小節（声）→ 1問＝2小節 × 10 → アウトロ2小節（声）。80 BPM で約74秒

## セットアップ・起動・テスト

- 必要なもの: Node.js 24（`.nvmrc`）、Chrome
- 初回: `npm install`
- 起動: `npm run dev` → `http://localhost:5173`（画面と `/api` が両方動く）
- AI を使うとき: `cp .dev.vars.example .dev.vars` してキーを入れる
- 心拍を試すとき: `npm run dev -- --host` で同じ Wi-Fi の iPhone からつなげるようにする。アプリの手順は `watch/README.md`
- ビルド確認: `npm run build`
- 公開（チームで相談してから）: `npm run build && npx wrangler deploy`（初回は `npx wrangler login`）
- テスト: 自動テストはまだない。音・カメラ・マイクはブラウザで実際に鳴らして確かめる

## ディレクトリ構成

流れ: 材料 → `toBlueprint()` → 設計図 → `compose()` → 楽譜 → `renderSong()` → WAV（受け渡しの形は `docs/interfaces.md`）

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
worker/heartRelay.js    入力2: 心拍の中継 /api/heart（iPhone → ブラウザ。Durable Objects）
wrangler.jsonc          Cloudflare の設定
watch/                  入力2: Apple Watch・iPhone アプリ（Xcode。手順は watch/README.md）
```

- 各ファイルは中身が空。先頭に【担当】・書くもの（関数の入力と出力）・参考のコードを書いてある
- 中身があるのは `src/blueprint.js`（設計図の形・既定値・見本）と `src/util.js` だけ
- 前に入れていた仮の実装は、git のコミット `9cd3bd4` で見られる
- 心拍まわり（`watch/`・`worker/heartRelay.js`・`src/sensor/heart.js`）は中身を作ってある
