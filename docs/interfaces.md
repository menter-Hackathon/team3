# 受け渡しのルール

部品どうし（関数の引数と戻り値）と、サーバー・アプリとのやり取り（JSON のメッセージ）の決まりごとです。

- `src/`・`worker/`・`watch/` で、受け渡しに関わるコードを書く・変える前に必ず読む。
- 形の正本は、このファイルと `src/blueprint.js`（設計図）。変えるときは「11. 形を変えるとき」に従う。

## 1. 全体の流れ

```
UI（src/main.js）が順番に呼ぶ
  入力:     recordVoice()（声の WAV）/ 叩いた間隔 / 10問の答え
  センサー: connectHeart() / startBlinks()（瞬き、案） / captureFace()（任意。作られていれば使う）
        ↓ 材料（Materials）……入力と出力の境目はこれだけ
  出力: toBlueprint(materials)      声・叩く＝たいが、質問＝うごてん（心拍・顔は取れたときだけ）
        ↓ 設計図（Blueprint）……出力の中で、ここより後ろは材料を直接見ない
  出力: compose(blueprint)          原曲4曲から1曲を選ぶ → MIDI を編集（うごてん）→ 楽譜（たいが）
        ↓ 楽譜（Score）
  出力: renderSong(score, assets) → WAV（たいが）
  映像: drawVisual(container, { blueprint, score, audio })
  サーバー: POST /api/title（曲名）・WebSocket /api/heart（心拍）
```

- 部品どうしは直接呼び合わない。どの順番で呼ぶかは UI だけが決める。
- 例外は出力の中（`toBlueprint` → `analyzeVoice`・`analyzeTaps`・`scoreQuiz`、`compose` → 原曲の選択・MIDI の編集、`renderSong` → `scheduleSong`・`audioBufferToWav`）。

### どのファイルからどのファイルへ

ブラウザの中のファイルどうしは、`main.js` が関数を呼び、戻り値を次のファイルの関数に渡す。ファイルはすべて `src/` の中（`input/`：voice・tap・quiz・toBlueprint、`sensor/`：heart・blink・face、`music/`：compose・sound・render・wav、`visual/`：sketch）。

名前は、そのまま変数名・引数名に使う。

- 声の WAV `voiceWav`：`voice.js`（入力）→ `main.js` → `toBlueprint.js`（Blob。`audio/wav` / `null`。分析は `toBlueprint.js` が `voice.js` の `analyzeVoice` で行う）
- 叩いた間隔 `tapIntervalsMs`：`main.js`（入力）→ `toBlueprint.js`（数値の配列、ミリ秒 / `null`。分析は `toBlueprint.js` が `tap.js` の `analyzeTaps` で行う）
- 10問の答え `quiz`：`main.js` → `toBlueprint.js`（JS オブジェクトの配列 `[{ value, responseMs }]` / `null`。点数は `toBlueprint.js` が `quiz.js` の `scoreQuiz` で出す）
- 心拍 `heart`：`heart.js` → `toBlueprint.js`（JS オブジェクト `{ bpm }` / `null`）
- 顔の音色 `face`：`face.js` → `toBlueprint.js`（JS オブジェクト `{ timbre }` / `null`）
- 瞬き `blinks`（案）：`blink.js` → `main.js` → `toBlueprint.js`（JS オブジェクト `{ timesMs, count, perMinute }` / `null`。UI が `startBlinks()` で返った tracker の `summarize()` でまとめて渡す）
- 材料まとめ `materials`：`main.js` → `toBlueprint.js`（JS オブジェクト `{ voiceWav, tapIntervalsMs, quiz, heart, face, blinks }`。`blinks` は案）
- 設計図 `blueprint`：`toBlueprint.js` → `compose.js`（JSON にできる形の JS オブジェクト。`sketch.js` と `/api/title` にも渡す）
- 原曲 `songs`：`compose.js` が読む（MIDI ファイル4つ。「6. 原曲」）
- 楽譜 `score`：`compose.js` → `render.js` → `sound.js`（JSON にできる形の JS オブジェクト）
- 声の音 `assets`：`toBlueprint.js` → `main.js` → `render.js` → `sound.js`（`{ voice: AudioBuffer / null }`。`voiceWav` を読み込み、前後の無音を切ったもの）
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
- ミリ秒は `performance.now()` で取った時刻と、その差（間隔）だけ。名前の最後に `Ms` を付ける（`tapTimesMs`、`tapIntervalsMs`、`responseMs`）。
- 周波数は名前に `Hz` を付ける（`pitchHz`）。音の高さのずれはセント（`detune`）。
- 強さ・割合は 0〜1。名前に単位は付けない（`energy`、`velocity`、`loudness`）。
- 音名は `"C4"` の形。シャープだけ使い、フラットは使わない（`"C#4"`）。主音はオクターブなし（`"D"`）。
- BPM は整数。

### 欠けたとき・失敗したとき
- 取れなかった材料は `null`。`undefined` や空のオブジェクトにしない。
- 入力の関数は、許可されない・機器がない・失敗した、のどれでも**例外を投げずに `null` を返す**。UI は `null` なら次へ進む。
- マイク・カメラを開いた関数は、値を返す前に必ず閉じる。例外は `startBlinks()`（測り続けるので、返した tracker の `stop()` で閉じる）。
- 受け取る側は値を信じすぎない。曲側は必ず `normalizeBlueprint()` を通してから使う。
- 例外を投げてよいのは `compose`（原曲の MIDI が読めないとき）と `renderSong` だけ（曲が作れないのは致命的なので）。UI はエラー画面を出す。

### 形式（全部が JSON ではない）
- ブラウザの中のファイルどうしは、関数の引数と戻り値で JS のオブジェクトをそのまま渡す（JSON の文字列にはしない）。
- JSON の文字列になるのは、サーバーとの通信（`/api/title`・`/api/heart`）だけ。
- 設計図と楽譜は、そのまま JSON にできる形にしておく（数値・文字列・真偽値・配列・オブジェクト・`null` だけ）。AI に送ったり、保存して見比べたりできるように。
- 声の音（AudioBuffer）と曲のファイル（Blob）は JSON にできないので、別に渡す（声の音は引数 `assets`）。

## 3. 関数の一覧

- `src/input/voice.js`（入力。`analyzeVoice`・`detectSpeech`・`trimBuffer` は出力の `toBlueprint` が使う）
  - `recordVoice(ms = 5000)` → 声の WAV（`Blob`）`| null`
  - `analyzeVoice(buffer)` → `VoiceFeatures`
- `src/input/tap.js`（入力。`analyzeTaps` は出力が使う）：`analyzeTaps(tapTimesMs)` → `Taps | null`（4回未満なら `null`）
- `src/input/quiz.js`（入力・うごてん）：`QUESTIONS`・`CHOICES`・`scoreQuiz(answers)` → `Traits`
- `src/input/toBlueprint.js`（出力）：`toBlueprint(materials)` → `Promise<{ blueprint, assets }>`（例外を投げない。WAV の読み込みがあるので async）
- `src/sensor/heart.js`（センサー・任意）：`connectHeart(url)` → `HeartConnection | null`
- `src/sensor/blink.js`（センサー・任意）：`startBlinks({ video, onBlink })` → `Promise<BlinkTracker | null>`（モデルを読み込んでからカメラを開く。20秒で読み込めなければ `null`）、`tracker.summarize(startMs, endMs)` → `Blinks | null`、`summarizeBlinks(timesMs, startMs, endMs)` → `Blinks`（数えるだけ）、`createBlinkDetector(options)`（目の閉じ具合 → 瞬きの判定）
- `src/sensor/face.js`（センサー・任意）：`captureFace()` → `Face | null`
- `src/music/compose.js`（出力。原曲の選択・編集＝うごてん、楽譜＝たいが）：`compose(blueprint)` → `Promise<Score>`（原曲の MIDI を読むので async）
- `src/music/edit/blueprintEdit.js`（出力・うごてん）：`editMidiByBlueprint(midi, blueprint, songKey)` → `{ midi, report }`
- `src/music/parts.js`（出力・共通。うごてんは自由に変えてよい・たいがへの確認は不要）：`findParts(midi)` → `{ pitched, melody, pad, drums }`・`isDrum(track)`（MIDI のトラックの見分け）
- `src/music/soundSettings.js`（出力・共通。うごてんは自由に変えてよい・たいがへの確認は不要）：`soundFromBlueprint(blueprint)` → 音の柔らかさの設定（楽譜の `sound`・MIDI の CC・sound.js が同じ数字を使う）
- `src/music/midiToScore.js`（出力・たいが）：`midiToScore(midi, blueprint)` → `{ score, report }`
- `src/music/sound.js`（出力・たいが）：`scheduleSong(score, assets)` → `Promise`（楽器を作って予約する。リバーブの準備ができたら終わる）
- `src/music/render.js`（出力・たいが）：`renderSong(score, assets)` → `Promise<Blob>`（WAV）
- `src/music/wav.js`（出力・たいが）：`audioBufferToWav(audioBuffer)` → `Blob`・`encodeWav(channels, sampleRate)` → `ArrayBuffer`
- `src/visual/sketch.js`（映像）：`drawVisual(container, { blueprint, score, audio })` → `{ remove() }`
- `src/blueprint.js`（全員）：`defaultBlueprint()`・`normalizeBlueprint(input)`・`SAMPLE_BLUEPRINT`

## 4. 材料（入力 → 出力の `toBlueprint`）

```ts
Materials = {
  voiceWav:       Blob | null,      // 録音した声の WAV（audio/wav）。入力が作る
  tapIntervalsMs: number[] | null,  // 叩いた間隔（ミリ秒）。[650, 640, 660, …]。3個未満（叩いたのが4回未満）なら null
  quiz:  QuizAnswer[] | null,       // 10個。UI が作る
  heart: { bpm: number } | null,    // 30〜220。UI がその時点の値を入れる
  face:  Face | null,
  blinks: Blinks | null,            // 案。カメラ・モデルが使えない、顔が映っていた時間が半分未満のときは null
}

// ここから下は出力の中（toBlueprint）で作る
VoiceFeatures = { duration: 秒, loudness: 0〜1, pitchHz: number | null, … }  // analyzeVoice の結果。今ある項目は src/input/voice.js の先頭に一覧
Taps          = { bpm: 60〜160 の整数, groove: [秒, 秒, 秒, 秒]（各 ±0.05）, stability: 0〜1（叩くたびのバラつきの小ささ）, count: 叩いた回数 }  // analyzeTaps の結果
QuizAnswer    = { value: 1〜5（選択肢は5つ。重みは quiz.js の CHOICE_WEIGHTS）, responseMs: 質問を出してから答えるまでのミリ秒, shownAtMs?: 質問を出した時刻（performance.now()。案、瞬きを問ごとに分けるため） }
Traits        = { extraversion, agreeableness, conscientiousness, neuroticism, openness }  // 各 0〜1
Face          = { timbre: number[] }  // 1〜16個、各 0〜1、1番目は 1
HeartConnection = { bpm: number | null（今の値。まだ届いていなければ null）, close(): void }
Blinks        = { timesMs: number[]（瞬きした時刻、performance.now() のミリ秒）, count: 回数, perMinute: 1分あたりの回数 }  // 案（材料に入れるかは未決定）
BlinkTracker  = { timesMs, score: 今の目の閉じ具合 0〜1, faceVisible, frames, detector, video, summarize(startMs, endMs): Blinks | null, stop(): void }
```

- `quiz` は `QUESTIONS` の順に並べる。途中でやめたら、途中までの配列ではなく `null` にする。
- `responseMs` は、質問を出した時刻を UI が覚えておいて測る。叩いた時刻も UI が `pointerdown` のたびに集め、隣どうしの差を `tapIntervalsMs` にして渡す。
- `Traits`（性格の点数）は `toBlueprint` の質問の部分（うごてん）の中だけで使う。設計図には入れない（AI や画面に性格の数字を出さないため）。
- `connectHeart` は、つながったままの接続を返す。材料として渡すときは、UI がその時点の値を `{ bpm }` にして渡す。
- 瞬き（案）：UI が10問の前に `startBlinks()` を始め、終わったら `tracker.summarize(1問目を出した時刻, 最後に答えた時刻)` で `blinks` にまとめ、`stop()` する。
  - モデルの読み込みに数秒かかる。10問が先に終わってから tracker が届いたら、UI は `stop()` して `blinks` は `null` にする。
  - 問ごとに分けるときは、`timesMs` と `quiz[i].shownAtMs`〜`shownAtMs + responseMs` を比べる（`shownAtMs` は UI が入れる）。
  - 設計図のどこに使うか（例：瞬きの位置でその問の区間に音を置く、回数で細かさを変える）は、出力（`toBlueprint`・MIDI の編集）の担当と相談して決める（未決定）。決まったら `sources` にも `blinks` を足す。

## 5. 設計図（出力の中：`toBlueprint` → `compose`）version 1

```json
{
  "version": 1,
  "baseSong": 2,
  "bpm": 78,
  "root": "D",
  "rootFromVoice": true,
  "scale": "dorian",
  "density": 0.7,
  "groove": [0, 0.03, -0.02, 0.05],
  "melodyRange": 0.6,
  "breathiness": 0.3,
  "stability": 0.8,
  "tempoDrift": 1.05,
  "timbre": [1, 0.4, 0.25, 0.1],
  "sections": [
    { "q": 1, "energy": 0.3, "brightness": 0.5, "hesitation": 0.1 }
  ],
  "sources": { "voice": true, "taps": true, "quiz": true, "heart": false, "face": false }
}
```

| 項目 | 範囲 | 何から決めるか | 作る人 | 使い方 |
|---|---|---|---|---|
| `version` | 1 | — | — | 設計図の形の版 |
| `baseSong`（追加） | 1〜4 の整数 | 質問 | うごてん | 原曲4曲のどれを使うか |
| `bpm` | 60〜160 の整数 | 叩いた速さ。心拍があれば心拍に寄せる | たいが | 曲のテンポ |
| `root` | `"C"`〜`"B"`（シャープだけ） | **声の高さ**（`pitchNote`） | たいが | 原曲をこのキーに移調する（`rootFromVoice` が true のときだけ） |
| `rootFromVoice`（追加） | 真偽値 | 声の高さが取れて `root` を決めたか | たいが | false なら、声があっても原曲のキーのまま（ささやき声など高さが取れない声のとき） |
| `scale` | `phrygian`・`aeolian`・`dorian`・`mixolydian`・`ionian`・`lydian`（暗い順） | 質問 | うごてん | 質問の部分で決めて使う（原曲の選択・音階 など。使い方はうごてんが決める） |
| `density` | 0〜1 | 質問 | うごてん | 音の多さ |
| `groove` | 4拍それぞれ秒（各 ±0.05） | 叩いたリズムのズレ | たいが | 音の時刻を拍の位置に合わせてずらす（ノリ） |
| `melodyRange`（追加） | 0〜1 | 声の抑揚（`pitchVariation`） | たいが | メロディの音域を広げる・狭める |
| `breathiness`（追加） | 0〜1 | 声の澄み具合（`clarity`）の逆 | たいが | リバーブの深さ・パッドの柔らかさ |
| `stability`（追加） | 0〜1 | 叩くたびのバラつきの小ささ | たいが | ドラム（ハイハット）の細かさ・揺らぎ |
| `tempoDrift`（追加） | 0.9〜1.1 | 叩く速さの前半と後半の比 | たいが | テンポの変化（最後のテンポ ÷ 最初のテンポ） |
| `timbre` | 1〜16個、各 0〜1 | 顔の輪郭（任意）。なければ既定の音色 | — | 音色（倍音の強さ） |
| `sections` | 必ず10個 | 質問（1問ごと） | うごてん | 1問ごとの区間（2小節）の `q`（1〜10）・盛り上がり `energy`・明るさ `brightness`・迷い `hesitation`（各 0〜1） |
| `sources` | 真偽値 | どの材料が取れたか | 全員 | 画面の表示・AI の曲名・確認。`voice` は声が録れていれば true（高さが取れなくても true。キーを変えるかは `rootFromVoice`）。`voice` がなければキー・メロディの音域・音の柔らかさは原曲のまま、`taps`・`heart` がなければテンポは原曲のまま、`taps` がなければテンポの変化・ノリ・ドラム・揺らぎも原曲のまま |

- （追加）の項目は、既定値があって、なくても動く追加なので `version` は 1 のまま（「11. 形を変えるとき」）。`src/blueprint.js` の `defaultBlueprint()`・`normalizeBlueprint()` にも足す。
- 足りない材料の所は既定値（`defaultBlueprint()`）のままにする。
- 性格 → 音楽の決め方（`baseSong`・`scale`・`density`・`sections` の決め方）は `toBlueprint` の質問の部分に書く（うごてん）。
- 曲の構成：イントロ2小節（声）→ 1問＝2小節 × 10 → アウトロ2小節（声）。80 BPM で約74秒。

## 6. 原曲（うごてん → `compose`）

原曲4曲は AI で作った MIDI（うごてんが作る）。`compose` が設計図の `baseSong` で1曲を選び、ほかの項目で編集する。

**ここに書いた決まりは、MIDI を編集する側（たいが）からの提案です。** 原曲を作るうごてんが決めます。作ってみて変えたいところがあれば、うごてんがこの節を直して PR で提案してください（編集のコードもそれに合わせます）。

- ファイル：`public/songs/song1.mid`〜`song4.mid`
- 拍子：4/4。曲の頭（0拍目）から小節を始める（弱起にしない）
- 長さ：24小節（イントロ2 + 1問2小節 × 10 + アウトロ2）
- トラック名：`melody`・`pad`・`bass`・`drums` のどれか（トラック名で見分けて編集する）
- ドラム：チャンネル10。キック 36・スネア 38・クローズド・ハイハット 42（General MIDI）
- キー：曲の頭にテキストのメタイベント `key: D dorian` の形で書く（主音はシャープだけ）。なければ音から推定するが、関係調と取り違えることがある
- テンポ：曲の頭にテンポを1つ入れる（途中で変えてもよい。変化は残したまま設計図の `bpm` に合わせる）

## 7. 楽譜（`compose` → `renderSong`）

```ts
Score = {
  bpm: number,        // 曲の最初のテンポ（途中で変わることがある）
  duration: 秒,        // 余韻も含めた長さ
  timbre: number[],    // 設計図のまま
  sound: { reverbDecay: 秒, reverbWet: 0〜1, padAttack: 秒, padRelease: 秒, padFilterHz: number },  // 設計図の breathiness から（soundFromBlueprint）
  structure: [{ name: "intro" | "q1" … "q10" | "outro", start: 秒, end: 秒 }],
  tracks: {
    voice:  [{ time, duration?, detune? }],   // duration がなければ最後まで（最大 10 秒）、detune がなければ元の高さ
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

- MIDI → 楽譜は `midiToScore`（たいが）。どの MIDI トラックをどの楽譜のトラックにするかは `src/music/midiToScore.js` の先頭に書いてある。
- トラック名はこの7つ。足すときは出力の担当で決める。`renderSong` の側は知らないトラックを無視して `console.warn` を出す。
- 各トラックの中は `time` の小さい順に並べる。同じトラックで同じ `time` を2回使わない（Tone.js でエラーになる）。
- `time` は 0 以上、`duration` 未満。
- `structure` は、映像と画面が「曲の今どこか」を知るために使う。
- テンポは曲の途中で変わることがある（原曲のテンポの変化・設計図の `tempoDrift`）。`bpm` は最初のテンポだけなので、`bpm` から拍や区間の時刻を計算しない。区間に合わせるときは `structure` の秒（テンポの変化も入っている）を使う。

## 8. 出力（WAV・映像）

- `renderSong(score, assets)` → WAV の `Blob`（`audio/wav`、44.1kHz・16bit・ステレオ）。一番大きい音が −1 dB になるように曲全体の音量をそろえる（音割れを防ぐ）。書き出す長さは `duration`。最後まで流す声がそれより長く続くときは、声の終わりまで伸ばす（アウトロの声が途中で切れないように）。
- 保存するファイル名は `rashisa-YYYYMMDD-HHMM.wav`。名前など個人の情報は入れない。
- 画面ではこの WAV を `<audio>` で流す（聞いた曲＝持ち帰る曲）。
- `renderSong` の書き出し中（`Tone.Offline`、数秒〜十数秒）は、Tone.js の全体の設定（context）が書き出し用に切り替わる。書き出しが終わるまで、ほかの音を鳴らしたり Tone.js の楽器・エフェクトを作ったりしない（書き出し用の側に作られて聞こえず、曲に混ざることもある）。UI は書き出し中の画面にしておく。
- `drawVisual(container, { blueprint, score, audio })` → `{ remove() }`。`audio` は再生中の `<audio>`。`audio.currentTime` と `score.structure` で、曲の今どこかが分かる。

## 9. サーバー・アプリとのやり取り

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

## 10. 個人情報（どこまで渡してよいか）

- 声：WAV と AudioBuffer は 入力 → UI → 出力 の中だけ。サーバー・AI に送らない。保存しない。
- 顔：`face.js` の外に出すのは `timbre` の数字だけ。画像や点の座標は出さない。
- 瞬き：`blink.js` の外に出すのは瞬きの時刻の数字だけ。カメラの映像は保存・送信しない。瞬きの多さを性格や気持ちの判定に使わない。
- 心拍：`bpm` の数字だけ。中継は配るだけで保存しない。
- 性格：点数（`Traits`）は `toBlueprint` の質問の部分（うごてん）の中だけ。設計図には音楽の数字にしてから入れる。
- AI に送るのは設計図の数字だけ。
- 名前や、人を見分ける ID は持たない。

## 11. 形を変えるとき

- 形を変えるときは、`src/blueprint.js`・このファイル・関係するファイル先頭の説明を、同じ PR で直す。
- **項目を足す**（既定値があり、なくても動く）：`version` はそのまま。使う側に一言伝える。
- **名前・意味・範囲を変える、項目を消す**：`version` を上げ、作る側と使う側を同じ `change/` ブランチの同じ PR で直す。関係する担当にレビューしてもらう。
