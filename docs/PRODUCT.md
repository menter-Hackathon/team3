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
- 原曲: AI で作った4曲の MIDI。@tonejs/midi で読み書きして編集する
- 映像: p5.js 2（使うときだけ読み込む）
- 表情・輪郭: MediaPipe Face Landmarker（@mediapipe/tasks-vision）
- 心拍: Apple Watch・iPhone アプリ（Swift、HealthKit、WatchConnectivity、XcodeGen）→ WebSocket → 中継（Durable Objects）→ ブラウザ
- AI: Claude API（@anthropic-ai/sdk、曲名と解説だけ）。Worker の中だけで呼ぶ。モデルは `worker/index.js` で決める
- サーバー・配信: Cloudflare Workers（wrangler 4、@cloudflare/vite-plugin）。R2・Durable Objects は必要になったら

## 設計の決まりごと

- **部品どうしの受け渡し（名前・単位・形・欠けたとき）は `docs/interfaces.md` に従う。受け渡しに関わるコードを書く・変える前に必ず読む**
- 入力と出力の境目は「材料」（録音した声の WAV・叩いた間隔・10問の答え）。入力側は材料を集めて渡すところまで、出力側は材料を受け取るところから
- 出力の中では「材料 → 設計図 → 楽譜 → WAV」の順に渡す。設計図より後ろ（MIDI の編集・楽譜・WAV）は材料を直接見ず、設計図だけを使う
- どの材料が取れなくても曲は作れるようにする（心拍・カメラ・ネットは任意）
- 体験者の声・顔・心拍は個人情報。保存しない。リポジトリにも入れない。声と顔はブラウザの外に出さない（心拍は中継を通るが、配るだけで保存しない）
- 顔の画像や映像を AI や外部サービスに送らない
- 顔の形から性格を判定しない。「○○タイプ」のようなタイプ分けはしない

## 役割

- UI: 画面の見た目と流れ。最後にみんなの部品をつなぐ
- 入力: 声を録音して WAV にする、叩いた間隔を集める、10問の答えと回答時間を集める。出力側に材料として渡す
- センサー（任意の要素）: Apple Watch の心拍、MediaPipe の表情・輪郭。入力側で作られていれば使い、なければ使わずに曲を作る
- 出力:
  - 原曲4曲（MIDI）を作る：うごてん
  - 材料 → 設計図（`toBlueprint`）：声・叩く＝たいが、質問＝うごてん（心拍・顔は任意。取れたときだけ使う）
  - 設計図 → 原曲4曲から1曲を選ぶ：うごてん
  - 設計図 → 選んだ原曲の MIDI を編集する：たいが
  - MIDI → 楽譜（Score）：たいが
  - 楽譜 → WAV（楽器・音色・エフェクト・音量・書き出し）：たいが

## 曲の設計図

- 出力の中で、材料から作って、原曲の選択・MIDI の編集に使う JSON。項目は `bpm`・`root`・`scale`・`density`・`groove`・`timbre`・`sections`（10問ぶん）・`sources`（どの材料が取れたか）と、追加の `baseSong`（原曲の番号）・`melodyRange`・`breathiness`・`stability`・`tempoDrift`
- 形・範囲・例は `docs/interfaces.md` の「5. 設計図」、既定値と見本は `src/blueprint.js`
- 原曲4曲の MIDI の決まりは `docs/interfaces.md` の「6. 原曲」
- 曲の構成: イントロ2小節（声）→ 1問＝2小節 × 10 → アウトロ2小節（声）。80 BPM で約74秒

## セットアップ・起動・テスト

- 必要なもの: Node.js 24（`.nvmrc`）、Chrome
- 初回: `npm install`
- 起動: `npm run dev` → `http://localhost:5173`（画面と `/api` が両方動く）
- AI を使うとき: `cp .dev.vars.example .dev.vars` してキーを入れる
- 心拍を試すとき: `npm run dev -- --host` で同じ Wi-Fi の iPhone からつなげるようにする。iPhone からは IP ではなく `ws://<Mac の名前>.local:5173/...` でつなぐ。アプリの手順は `watch/README.md`
- 瞬きを試すとき: `npm run dev` → `http://localhost:5173/dev/blink`（カメラを使う。60秒ずつはかって、人による違いを比べられる）
- ビルド確認: `npm run build`
- 公開（チームで相談してから）: `npm run build && npx wrangler deploy`（初回は `npx wrangler login`）
- テスト: 自動テストはまだない。音・カメラ・マイクはブラウザで実際に鳴らして確かめる

## ディレクトリ構成

流れ: 材料（入力）→ `toBlueprint()` → 設計図 → `compose()`（原曲を選ぶ → MIDI を編集 → 楽譜）→ `renderSong()` → WAV（ここまで出力。受け渡しの形は `docs/interfaces.md`）

```
index.html              画面の入口（UI）
src/main.js             画面の流れ。各担当の部品をつなぐ（UI）
src/style.css           見た目（UI）
src/blueprint.js        曲の設計図の形・既定値・見本（全員。変えるときは相談）
src/util.js             共通の小さな関数
src/input/              入力: voice.js（声の録音・分析）・tap.js（叩く）・quiz.js（10問）
src/input/toBlueprint.js 出力: 材料 → 設計図（声・叩く＝たいが、質問＝うごてん）
src/sensor/             センサー（任意）: heart.js（心拍）・blink.js（瞬き）・face.js（顔の輪郭 → 音色、保留）
src/music/compose.js    出力: 設計図 → 原曲を選ぶ → MIDI を編集 → 楽譜
src/music/edit/         出力: 原曲の MIDI を設計図で編集する
src/music/sound.js      出力: 楽器・音色・エフェクト・音量
src/music/render.js     出力: 楽譜 → WAV（Tone.Offline）。wav.js が WAV 形式に変換
src/visual/sketch.js    映像（p5.js）
worker/index.js         サーバー（Cloudflare Worker）: /api/title（AI で曲名）・/api/health
worker/heartRelay.js    センサー（任意）: 心拍の中継 /api/heart（iPhone → ブラウザ。Durable Objects）
wrangler.jsonc          Cloudflare の設定
watch/                  センサー（任意）: Apple Watch・iPhone アプリ（Xcode。手順は watch/README.md）
dev/                    開発用の確認ページ（blueprint-edit.html：設計図で MIDI を編集、blink.html：瞬き）
```

- 各ファイルは中身が空。先頭に【担当】・書くもの（関数の入力と出力）・参考のコードを書いてある
- 中身があるのは `src/blueprint.js`（設計図の形・既定値・見本）と `src/util.js` だけ
- 前に入れていた仮の実装は、git のコミット `9cd3bd4` で見られる
- 心拍まわり（`watch/`・`worker/heartRelay.js`・`src/sensor/heart.js`）と瞬き（`src/sensor/blink.js`）は中身を作ってある
