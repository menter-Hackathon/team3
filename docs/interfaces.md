# 受け渡しのルール

部品どうし（関数の引数と戻り値）と、サーバー・アプリとのやり取り（JSON のメッセージ）の決まりごとです。

- `src/`・`worker/`・`watch/` で、受け渡しに関わるコードを書く・変える前に必ず読む。
- 形の正本は、このファイルと `src/blueprint.js`（設計図）。変えるときは「10. 形を変えるとき」に従う。

## 1. 全体の流れ

```
UI（src/main.js）が順番に呼ぶ
  入力1: recordVoice() / analyzeTaps() / 10問 / scoreQuiz()
  入力2: connectHeart() / captureFace()
        ↓ 材料（Materials）
  入力1: toBlueprint(materials)
        ↓ 設計図（Blueprint）……入力と曲の境目はこれだけ
  曲1:  compose(blueprint)
        ↓ 楽譜（Score）
  曲2:  renderSong(score, assets) → WAV
  映像: drawVisual(container, { blueprint, score, audio })
  サーバー: POST /api/title（曲名）・WebSocket /api/heart（心拍）
```

- 部品どうしは直接呼び合わない。どの順番で呼ぶかは UI だけが決める。
- 例外は同じ担当の中だけ（`toBlueprint` → `scoreQuiz`、`renderSong` → `scheduleSong`・`audioBufferToWav`）。

### どのファイルからどのファイルへ

ブラウザの中のファイルどうしは、`main.js` が関数を呼び、戻り値を次のファイルの関数に渡す。ファイルはすべて `src/` の中（`input/`：voice・tap・quiz・toBlueprint、`sensor/`：heart・face、`music/`：compose・sound・render・wav、`visual/`：sketch）。

名前は、そのまま変数名・引数名に使う。

- 声 `voice`：`voice.js` → `toBlueprint.js`（JS オブジェクト `{ buffer, features }` / `null`）
- 叩いた時刻 `tapTimesMs`：`main.js` → `tap.js`（数値の配列、ミリ秒）
- リズム `taps`：`tap.js` → `toBlueprint.js`（JS オブジェクト `{ bpm, groove, count }` / `null`）
- 10問の答え `quiz`：`main.js` → `toBlueprint.js`（JS オブジェクトの配列 `[{ value, responseMs }]` / `null`。点数は `toBlueprint.js` が `quiz.js` の `scoreQuiz` で出す）
- 心拍 `heart`：`heart.js` → `toBlueprint.js`（JS オブジェクト `{ bpm }` / `null`）
- 顔の音色 `face`：`face.js` → `toBlueprint.js`（JS オブジェクト `{ timbre }` / `null`）
- 材料まとめ `materials`：`main.js` → `toBlueprint.js`（JS オブジェクト `{ voice, taps, quiz, heart, face }`）
- 設計図 `blueprint`：`toBlueprint.js` → `compose.js`（JSON にできる形の JS オブジェクト。`sketch.js` と `/api/title` にも渡す）
- 楽譜 `score`：`compose.js` → `render.js` → `sound.js`（JSON にできる形の JS オブジェクト）
- 声の音 `assets`：`main.js` → `render.js` → `sound.js`（`{ voice: AudioBuffer / null }`）
- 曲 `wav`：`render.js`（`wav.js` で変換）→ `main.js`（Blob。WAV ファイル）
- 映像の材料（引数 `{ blueprint, score, audio }`）：`main.js` → `sketch.js`。`audio` は再生中の `<audio>`
- 曲名 `titleResult`：`worker/index.js` → `main.js`（通信。JSON `{ title, comment, ai }`。送るのは `blueprint`）
- 心拍の中継 `heartMessage`：iPhone アプリ（`RelayModel.swift`）→ `worker/heartRelay.js` → `heart.js`（通信。JSON `{ bpm }`）
- Watch → iPhone（キー `bpm`・`at`）：`WorkoutManager.swift` → `RelayModel.swift`（WatchConnectivity の辞書。`at` は測った時刻）

## 2. 共通ルール

### 名前
- 変数・関数・JSON のキーは英語の camelCase（`responseMs`、`toBlueprint`）。
- 関数名は動詞から始める（record / analyze / capture / connect / compose / render / draw）。
- 決まった選択肢から選ぶ値は、英小文字の文字列（`"dorian"`、`"send"`）。
- 定数は大文字のスネークケース（`SECTION_COUNT`）。ファイル名は `camelCase.js`。
- 受け渡すものの変数名・引数名は「1. どのファイルからどのファイルへ」の名前にそろえる（`blueprint`・`score`・`materials` など小文字から）。形の名前（型）は大文字から（`Blueprint`・`Score`・`Materials`）。

### 単位
- 時間は**秒**が基本（`time`・`duration`・`start`・`end`）。
- ミリ秒は `performance.now()` で取った生の時刻だけ。名前の最後に `Ms` を付ける（`tapTimesMs`、`responseMs`）。
- 周波数は名前に `Hz` を付ける（`pitchHz`）。音の高さのずれはセント（`detune`）。
- 強さ・割合は 0〜1。名前に単位は付けない（`energy`、`velocity`、`loudness`）。
- 音名は `"C4"` の形。シャープだけ使い、フラットは使わない（`"C#4"`）。主音はオクターブなし（`"D"`）。
- BPM は整数。

### 欠けたとき・失敗したとき
- 取れなかった材料は `null`。`undefined` や空のオブジェクトにしない。
- 入力の関数は、許可されない・機器がない・失敗した、のどれでも**例外を投げずに `null` を返す**。UI は `null` なら次へ進む。
- マイク・カメラを開いた関数は、値を返す前に必ず閉じる。
- 受け取る側は値を信じすぎない。曲側は必ず `normalizeBlueprint()` を通してから使う。
- 例外を投げてよいのは `renderSong` だけ（曲が作れないのは致命的なので）。UI はエラー画面を出す。

### 形式（全部が JSON ではない）
- ブラウザの中のファイルどうしは、関数の引数と戻り値で JS のオブジェクトをそのまま渡す（JSON の文字列にはしない）。
- JSON の文字列になるのは、サーバーとの通信（`/api/title`・`/api/heart`）だけ。
- 設計図と楽譜は、そのまま JSON にできる形にしておく（数値・文字列・真偽値・配列・オブジェクト・`null` だけ）。AI に送ったり、保存して見比べたりできるように。
- 声の音（AudioBuffer）と曲のファイル（Blob）は JSON にできないので、別に渡す（声の音は引数 `assets`）。

## 3. 関数の一覧

- `src/input/voice.js`（入力1）
  - `recordVoice(ms = 5000)` → `Voice | null`
  - `analyzeVoice(buffer)` → `VoiceFeatures`
- `src/input/tap.js`（入力1）：`analyzeTaps(tapTimesMs)` → `Taps | null`（4回未満なら `null`）
- `src/input/quiz.js`（入力1）：`QUESTIONS`・`CHOICES`・`scoreQuiz(answers)` → `Traits`
- `src/input/toBlueprint.js`（入力1）：`toBlueprint(materials)` → `Blueprint`（例外を投げない）
- `src/sensor/heart.js`（入力2）：`connectHeart(url)` → `HeartConnection | null`
- `src/sensor/face.js`（入力2）：`captureFace()` → `Face | null`
- `src/music/compose.js`（曲1）：`compose(blueprint)` → `Score`
- `src/music/sound.js`（曲2）：`scheduleSong(score, assets)` → なし（楽器を作って予約する）
- `src/music/render.js`（曲2）：`renderSong(score, assets)` → `Blob`（WAV）
- `src/music/wav.js`（曲2）：`audioBufferToWav(audioBuffer)` → `Blob`
- `src/visual/sketch.js`（映像）：`drawVisual(container, { blueprint, score, audio })` → `{ remove() }`
- `src/blueprint.js`（全員）：`defaultBlueprint()`・`normalizeBlueprint(input)`・`SAMPLE_BLUEPRINT`

## 4. 材料（入力 → `toBlueprint`）

```ts
Materials = {
  voice: Voice | null,
  taps:  Taps | null,
  quiz:  QuizAnswer[] | null,   // 10個。UI が作る
  heart: { bpm: number } | null, // 30〜220。UI がその時点の値を入れる
  face:  Face | null,
}

Voice         = { buffer: AudioBuffer, features: VoiceFeatures }
VoiceFeatures = { duration: 秒, loudness: 0〜1, pitchHz: number | null }  // 項目は足してよい
Taps          = { bpm: 60〜160 の整数, groove: [秒, 秒, 秒, 秒]（各 ±0.05）, count: 叩いた回数 }
QuizAnswer    = { value: 1〜7, responseMs: 質問を出してから答えるまでのミリ秒 }
Traits        = { extraversion, agreeableness, conscientiousness, neuroticism, openness }  // 各 0〜1
Face          = { timbre: number[] }  // 1〜16個、各 0〜1、1番目は 1
HeartConnection = { bpm: number | null（今の値。まだ届いていなければ null）, close(): void }
```

- `quiz` は `QUESTIONS` の順に並べる。途中でやめたら、途中までの配列ではなく `null` にする。
- `responseMs` は、質問を出した時刻を UI が覚えておいて測る。叩いた時刻（`tapTimesMs`）も UI が `pointerdown` のたびに集める。
- `Traits`（性格の点数）は入力1の中だけで使う。設計図には入れない（AI や画面に性格の数字を出さないため）。
- `connectHeart` は、つながったままの接続を返す。材料として渡すときは、UI がその時点の値を `{ bpm }` にして渡す。

## 5. 設計図（入力 → 曲）version 1

```json
{
  "version": 1,
  "bpm": 78,
  "root": "D",
  "scale": "dorian",
  "density": 0.7,
  "groove": [0, 0.03, -0.02, 0.05],
  "timbre": [1, 0.4, 0.25, 0.1],
  "sections": [
    { "q": 1, "energy": 0.3, "brightness": 0.5, "hesitation": 0.1 }
  ],
  "sources": { "voice": true, "taps": true, "quiz": true, "heart": false, "face": false }
}
```

- `version`：設計図の形の版（今は 1）。
- `bpm`：60〜160 の整数。叩いた速さから決める。心拍があれば心拍に寄せる。
- `root`：主音。12音（`"C"`〜`"B"`、シャープだけ）のどれか。
- `scale`：音階。暗い順に `phrygian`・`aeolian`・`dorian`・`mixolydian`・`ionian`・`lydian`。
- `density`：音の多さ（0〜1）。
- `groove`：叩いたリズムのズレ。4拍それぞれを何秒前後にずらすか（各 ±0.05）。
- `timbre`：倍音の強さ（1〜16個、各 0〜1）。顔の輪郭から作る。なければ既定の音色。
- `sections`：必ず10個。1問ごとの区間（2小節）の `q`（1〜10）・盛り上がり `energy`・明るさ `brightness`・迷い `hesitation`（各 0〜1）。
- `sources`：どの材料が取れたか（真偽値）。画面の表示・AI の曲名・確認に使う。声を実際に鳴らすかどうかは `assets.voice` があるかで決める。
- 足りない材料の所は既定値（`defaultBlueprint()`）のままにする。
- 性格 → 音楽の決め方（`scale`・`root`・`density`・`sections` の決め方）は `toBlueprint` に書く。決めるのは入力1と曲1の2人。
- 曲の構成：イントロ2小節（声）→ 1問＝2小節 × 10 → アウトロ2小節（声）。80 BPM で約74秒。

## 6. 楽譜（曲1 → 曲2）

```ts
Score = {
  bpm: number,
  duration: 秒,        // 余韻も含めた長さ
  timbre: number[],    // 設計図のまま
  structure: [{ name: "intro" | "q1" … "q10" | "outro", start: 秒, end: 秒 }],
  tracks: {
    voice:  [{ time, duration?, detune? }],   // duration がなければ最後まで、detune がなければ元の高さ
    pad:    [{ time, notes: ["D4", "F4", "A4"], duration, velocity }],
    bass:   [{ time, note: "D2", duration, velocity }],
    melody: [{ time, note: "A4", duration, velocity }],
    kick:   [{ time, velocity }],
    snare:  [{ time, velocity }],
    hat:    [{ time, velocity }],
  },
}

assets = { voice: AudioBuffer | null }
```

- トラック名はこの7つ。足すときは曲1と曲2で決める。曲2は知らないトラックを無視して `console.warn` を出す。
- 各トラックの中は `time` の小さい順に並べる。同じトラックで同じ `time` を2回使わない（Tone.js でエラーになる）。
- `time` は 0 以上、`duration` 未満。
- `structure` は、映像と画面が「曲の今どこか」を知るために使う。

## 7. 出力（WAV・映像）

- `renderSong(score, assets)` → WAV の `Blob`（`audio/wav`、44.1kHz・16bit・ステレオ）。
- 保存するファイル名は `rashisa-YYYYMMDD-HHMM.wav`。名前など個人の情報は入れない。
- 画面ではこの WAV を `<audio>` で流す（聞いた曲＝持ち帰る曲）。
- `drawVisual(container, { blueprint, score, audio })` → `{ remove() }`。`audio` は再生中の `<audio>`。`audio.currentTime` と `score.structure` で、曲の今どこかが分かる。

## 8. サーバー・アプリとのやり取り

### `POST /api/title`（曲名）
- 送る：設計図（JSON）。サーバーは数字と決まった文字列だけ使う。
- 返す：200 `{ "title": "…", "comment": "…", "ai": true }`
  - `title` は20字以内、`comment` は60字以内。
  - AI が使えない・失敗したときも 200 で、決まった曲名と `"ai": false` を返す。
- エラー：JSON が壊れている 400、10KB を超える 413。

### WebSocket `/api/heart?role=send|listen&room=…`（心拍の中継）
- 中身はテキストの JSON：`{"bpm":72}`（30〜220 の整数）。
- `send`（iPhone）から届いた値を、同じ部屋の `listen`（ブラウザ）全員に同じ形で配る。
- `room` は英小文字・数字・ハイフン。付けなければ `default`。
- 知らないキーは無視する（あとで項目を足せるように）。

### `GET /api/health`
- `{ "ok": true }`

### Apple Watch → iPhone（WatchConnectivity）
- `["bpm": Double, "at": 測った時刻（1970年からの秒）]` を `sendMessage` で送る。iPhone のアプリが開いていない・送れなかったときは、最新の値だけを `applicationContext` に置く。
- iPhone は、10秒より古い値と、前に受け取ったものより古い・同じ時刻の値（2通りの送り方で2回届いたもの）を捨てる。

## 9. 個人情報（どこまで渡してよいか）

- 声：AudioBuffer は 入力1 → UI → 曲2 の中だけ。サーバー・AI に送らない。保存しない。
- 顔：`face.js` の外に出すのは `timbre` の数字だけ。画像や点の座標は出さない。
- 心拍：`bpm` の数字だけ。中継は配るだけで保存しない。
- 性格：点数（`Traits`）は入力1の中だけ。設計図には音楽の数字にしてから入れる。
- AI に送るのは設計図の数字だけ。
- 名前や、人を見分ける ID は持たない。

## 10. 形を変えるとき

- 形を変えるときは、`src/blueprint.js`・このファイル・関係するファイル先頭の説明を、同じ PR で直す。
- **項目を足す**（既定値があり、なくても動く）：`version` はそのまま。使う側に一言伝える。
- **名前・意味・範囲を変える、項目を消す**：`version` を上げ、作る側と使う側を同じ `change/` ブランチの同じ PR で直す。関係する担当にレビューしてもらう。
