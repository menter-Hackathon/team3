import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var relay: RelayModel
    @AppStorage("relayURL") private var relayURL = ""
    @AppStorage("wasConnected") private var wasConnected = false // 前回つないだままアプリが終わったか

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Image(systemName: "heart")
                            .foregroundStyle(.pink)
                        Text(relay.heartRate.map { "\(Int($0.rounded()))" } ?? "--")
                            .font(.system(size: 56, weight: .semibold, design: .rounded))
                            .monospacedDigit()
                        Text("BPM")
                            .foregroundStyle(.secondary)
                    }
                    LabeledContent("Apple Watch", value: relay.watchStatus)
                    LabeledContent("最後に届いた") {
                        if let at = relay.lastReceivedAt {
                            Text(at, style: .relative)
                        } else {
                            Text("--")
                        }
                    }
                    Toggle("ダミーの心拍を送る", isOn: $relay.useDummy)
                } header: {
                    Text("心拍")
                } footer: {
                    Text("ダミーは Watch がなくても試せるように、65〜95 の値を2秒おきに作ります。")
                }

                Section {
                    TextField("wss://<サイト>/api/heart?role=send", text: $relayURL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .disabled(relay.wantsConnection)
                    Button(relay.wantsConnection ? "切断する" : "接続する") {
                        if relay.wantsConnection {
                            relay.disconnect()
                        } else {
                            relay.connect(to: relayURL)
                        }
                    }
                    LabeledContent("状態", value: relay.socketStatus)
                    LabeledContent("送った数", value: "\(relay.sentCount)")
                } header: {
                    Text("中継サーバー")
                } footer: {
                    Text("手元で試すときは ws://<Mac の名前>.local:5173/api/heart?role=send（IP アドレスは使えません）。送っている間は画面を開いたままにしてください。")
                }
            }
            .navigationTitle("心拍リレー")
        }
        // 送っている間は画面を消さない（消えると iOS が通信を止める）
        .onChange(of: relay.wantsConnection) { _, connected in
            UIApplication.shared.isIdleTimerDisabled = connected
            wasConnected = connected
        }
        // アプリが落ちて開き直したときは、前回つないでいたなら自動でつなぎ直す（「切断する」を押したときはつながない）
        .task {
            if wasConnected, !relayURL.isEmpty, !relay.wantsConnection { relay.connect(to: relayURL) }
        }
        #if DEBUG
        // 開発用: 起動引数 -relayURL ws://... -dummy YES -autoConnect YES で、画面を触らずに送り始める
        .task {
            let defaults = UserDefaults.standard
            if defaults.bool(forKey: "dummy") { relay.useDummy = true }
            if defaults.bool(forKey: "autoConnect"), !relay.wantsConnection { relay.connect(to: relayURL) }
        }
        #endif
    }
}
