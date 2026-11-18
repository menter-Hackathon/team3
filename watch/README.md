# 心拍リレー（Apple Watch・iPhone アプリ）

Apple Watch で測った心拍を、iPhone を通して中継サーバー（`worker/heartRelay.js`）に送るアプリです。中継は、届いた心拍をブラウザに配ります。

```
Apple Watch（HeartWatch）── WatchConnectivity ──▶ iPhone（HeartPhone）── WebSocket ──▶ /api/heart ──▶ ブラウザ
```

- **Watch**：「測る」を押すとワークアウトが始まり、数秒おきの心拍を iPhone に送ります。止めるとワークアウトごと捨てるので、ヘルスケアには保存されません。
  - 15秒心拍が届かないと、Watch の着け方とヘルスケアの許可を確かめるよう表示が出ます（許可を拒否していると、エラーにならずに心拍だけが届かないため）。
- **iPhone**：届いた心拍を `{"bpm":72}` の形で中継に送ります。
  - 切れたら2秒後につなぎ直します。アプリが落ちて開き直したときも、前回つないでいたら自動でつなぎ直します（「切断する」を押したときはつながない）。
  - 10秒より古い値や、2回届いた同じ値は送りません。「最後に届いた」で、Watch から届いているかが分かります。
  - 送っている間は、画面を開いたままにしてください（閉じると iOS が通信を止めます）。
- **ダミー**：iPhone の「ダミーの心拍を送る」をオンにすると、Watch がなくても 65〜95 の値を2秒おきに送ります。

## はじめて動かすとき

1. 署名の設定を作る（このファイルは git に入りません）
   ```bash
   cd watch
   cp Config/Local.xcconfig.example Config/Local.xcconfig
   ```
   `Local.xcconfig` に、自分の Team ID と、ほかの人とかぶらない Bundle ID の先頭を書く。チームは Xcode の Signing 画面ではなく、ここで設定する。
2. Xcode で `watch/HeartRelay.xcodeproj` を開く
3. スキーム `HeartPhone` を選び、iPhone を実機につないで実行する。ペアリング済みの Watch にも、アプリが入る
4. Watch でアプリを開いて「測る」を押す。最初の1回だけ、ヘルスケアの許可を聞かれる

- 対応する OS：iPhone は iOS 27 以上。Apple Watch は watchOS 9 以上（Series 4 以降なら、どの機種でもよい。Xcode 27 が作れる一番古い watchOS）。
- 署名は無料の Personal Team でよい（Apple の表で、HealthKit は無料の「Apple Developer」でも使える）。
- ただし無料のチームで入れたアプリは、7日ほどで起動できなくなります。発表や展示の前日に、Xcode からもう一度入れ直してください。

## 中継につなぐ

- **手元で試す**：Mac で `npm run dev -- --host` を実行する。iPhone の URL は `ws://<Mac の IP>:5173/api/heart?role=send`。Mac と iPhone は同じ Wi-Fi につなぐ
- **公開したサイト**：`wss://<サイト>/api/heart?role=send`
- **ブラウザ側**：画面の URL に `?heart` を付けると、`src/sensor/heart.js` の `connectHeart()` が同じサイトの `/api/heart?role=listen` につなぎ、届いた心拍（直近10個の中央値）を返します。15秒届かなければ `null` に戻ります
  - 画面ができる前に試すとき：`http://localhost:5173/?heart` を開き、開発者ツールのコンソールで `hc = (await import('/src/sensor/heart.js')).connectHeart()` を実行し、`hc.bpm` で今の値を見る
- **部屋を分ける**：`&room=名前` を付けると、同じ部屋の人どうしだけでやり取りします（付けないと `default`）

## ファイルを足したり、設定を変えたりしたら

`project.yml` が正本です。直したら、`watch/` で `xcodegen` を実行してプロジェクトを作り直します（Homebrew：`brew install xcodegen`）。

## 開発用の起動オプション（シミュレーターで画面を触らずに試す）

```bash
# iPhone：中継につないで、ダミーの心拍を送る
xcrun simctl launch <iPhone> <Bundle ID> -relayURL "ws://127.0.0.1:5173/api/heart?role=send" -dummy YES -autoConnect YES
# Watch：センサーの代わりにダミーの心拍を作って、すぐ測り始める（Watch → iPhone のやりとりを試す用）
xcrun simctl launch <Watch> <Bundle ID>.watchkitapp -dummyHeart YES -autoStart YES
```

- Debug ビルドのときだけ効きます。
- Watch と iPhone のシミュレーターは、組（`xcrun simctl list pairs`）になっているものを使う。
- シミュレーターではヘルスケアの許可を出せないので、本物のセンサーで測るところは実機で試す。
