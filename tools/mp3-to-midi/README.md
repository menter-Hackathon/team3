# 原曲 MP3 → MIDI 変換ツール

AI で作った原曲（MP3・約3分）を、プロダクトが読む MIDI にする道具です。プロダクトの外で一度だけ使います（ビルドには含めません）。担当はうごてんです。

```
MP3 ─① 分離（Demucs htdemucs_6s）→ vocals / drums / bass / guitar / piano / other の WAV
    ─② 解析（librosa）→ 拍の時刻・小節の頭・キー
    ─③ 採譜 ─ 音程のあるパート: Basic Pitch（Spotify）
             └ drums: 帯域ごとに音の出始めを探して分類
    ─④ 全曲の細かい MIDI → full/songN.mid（git に入れる）
    ─⑤ 48 小節を切り出す → public/songs/songN.mid（プロダクトが読む。compose が頭から必要な小節だけ使う）
```

MP3 と途中のファイル（`work/`）は git に入れません。

## 環境を作る（初回だけ）

Python 3.11 が必要です（3.13 では torch・basic-pitch が入らないことがあります）。

```bash
cd tools/mp3-to-midi
conda create -y -p .venv python=3.11
.venv/bin/pip install -r requirements.txt
```

- Demucs のモデルは、初回の分離のときに自動でダウンロードされます（公式の配布元から）
- Basic Pitch は、Mac では CoreML のモデル（パッケージに同梱）を使います
- Claude Code の sandbox の中では、CoreML と conda・pip がシステムの一時フォルダやキャッシュに書けずに失敗します。そのときは sandbox の外で動かしてください

## 使い方

```bash
cd tools/mp3-to-midi
.venv/bin/python convert.py song1                  # 1曲
.venv/bin/python convert.py --all                  # 4曲
.venv/bin/python convert.py song1 --start-bar 16   # 切り出す区間だけ試す（songs.json は書き換えない）
```

- MP3 は `songs.json` の `sourceDir`（既定は `~/Downloads/mp3`）から読みます
- ① 分離（1曲 15 秒ほど）と ③ 採譜の結果は `work/` に残り、次からは飛ばします。やり直すときは `--force-separate` / `--force-transcribe`
- 実行すると、パートごとの音の数・音域・格子にそろった割合と、4小節ごとの音の数を表示します。切り出す区間を選ぶ目安にしてください

## 曲ごとの設定（`songs.json`）

`defaults` に全曲の既定値を書き、`songs.songN` で曲ごとに上書きします。

| 項目 | 意味 | 既定 |
|---|---|---|
| `source` | `sourceDir` の中の MP3 の名前 | — |
| `startBar` | 切り出す最初の小節（0 始まり）。`null` なら4パートが一番そろって鳴る区間を仮に選ぶ | `null` |
| `melody` / `pad` | どのパートを melody / pad にするか（`vocals` `guitar` `piano` `other`）。`auto` は自動 | `auto` |
| `bpm` | 拍の検出が外れたときのテンポの目安 | `null` |
| `downbeatSec` | 小節の頭の秒（どこでもよいので1か所）。小節の頭が1拍ずれたときに使う | `null` |
| `key` | キー（例 `"D dorian"`。主音はシャープ、音階は `src/blueprint.js` の `SCALES`） | `null`（推定） |
| `grid` | 1拍をいくつに分けて合わせるか（4＝16分、8＝32分、3＝3連） | `4` |
| `minNoteBeats` | これより短い音（拍）は消す | `0.125` |
| `minVelocity` | これより弱い音（0〜1）は消す | `0.18` |
| `melodyMin` | melody にする一番低い音（MIDI の番号。55＝G3） | `55` |
| `padMaxVoices` | 同じ時刻に残す和音の数 | `6` |
| `onsetThreshold` / `frameThreshold` | Basic Pitch のしきい値（上げると音が減る） | `0.5` / `0.3` |
| `drumDelta` | ドラムの音の出始めを見つけるしきい値（上げると音が減る） | `0.05` |

`onsetThreshold`・`frameThreshold`・`drumDelta` を変えたときは、③ の採譜を自動でやり直します。

## できる MIDI

| トラック | 元にするパート | 中身 |
|---|---|---|
| `melody` | vocals（歌がはっきり入っているとき）か、いちばん高いパート | 単音。同じ時刻なら一番高い音 |
| `pad` | 和音が一番多いパート | 和音（`padMaxVoices` 個まで） |
| `bass` | bass | 単音。同じ時刻なら一番低い音 |
| `drums`（ch10） | drums | キック36・スネア38・ハイハット閉42 / 開46・クラッシュ49・タム45 / 48 |
| `keys` `guitar` `synth` `sing` | 残りのパート（melody にした音の残りも） | 今のプロダクトでは鳴らない。楽譜と音を広げればアレンジに使える |

- 先頭にテンポ1つ・4/4・テキストの `key: D dorian` を書きます（`docs/interfaces.md` の「6. 原曲」）
- AI で作った曲はテンポが揺れるので、検出した拍を基準にして16分音符に合わせています。MIDI のテンポは一定です（プロダクトでは設計図の `bpm` に合わせ直します）

## 聞いて確かめる

1. `npm run dev` → `http://localhost:5173/dev/blueprint-edit.html`
2. `public/songs/songN.mid` を読み込み、編集 → WAV で鳴らして、原曲の MP3 と聞き比べる
3. 小節の頭がずれていたら `downbeatSec`、キーが違ったら `key`、melody / pad が合っていなかったら `melody` / `pad` を `songs.json` に書き、もう一度 `convert.py` を実行する

## 分かっている限界

- 1つの音源から自動で採譜するので、完全には取れません。和音の多いパート（other・guitar）は音が多くなりやすく、ベースは出始めの時刻が少しぶれます
- ドラムの分類は帯域のエネルギーで決めているので、ライド・タンバリンなどは区別しません
