import Foundation
import WatchConnectivity

/// Watch から届いた心拍を、WebSocket で中継サーバー（worker/heartRelay.js）に送る。
/// 送る形: {"bpm":72}（中継がそのままブラウザ側の src/sensor/heart.js に配る）
/// iPhone のアプリは開いたままにする（閉じると iOS が通信を止める）。
final class RelayModel: NSObject, ObservableObject {
    @Published var heartRate: Double?
    @Published var lastReceivedAt: Date? // Watch（またはダミー）から最後に心拍が届いた時刻
    @Published var watchStatus = "確認中"
    @Published var socketStatus = "未接続"
    @Published var wantsConnection = false
    @Published var sentCount = 0
    @Published var useDummy = false {
        didSet { updateDummy() }
    }

    private var socket: URLSessionWebSocketTask?
    private var serverURL: URL?
    private var retry: DispatchWorkItem?
    private var dummyTimer: Timer?
    private var lastMeasuredAt: Double? // 最後に使った心拍を Watch が測った時刻（1970年からの秒）

    override init() {
        super.init()
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
    }

    // MARK: - 中継サーバーにつなぐ

    func connect(to text: String) {
        guard let url = URL(string: text.trimmingCharacters(in: .whitespaces)),
              let scheme = url.scheme, ["ws", "wss"].contains(scheme) else {
            socketStatus = "ws:// か wss:// で始まる URL を入れてください"
            return
        }
        disconnect()
        serverURL = url
        wantsConnection = true
        open(url)
    }

    func disconnect() {
        wantsConnection = false
        retry?.cancel()
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        socketStatus = "未接続"
    }

    private func open(_ url: URL) {
        let task = URLSession.shared.webSocketTask(with: url)
        socket = task
        socketStatus = "接続中…"
        task.resume()
        listen(task)
        // つながったかを ping で確かめる
        task.sendPing { [weak self] error in
            DispatchQueue.main.async {
                guard let self, task === self.socket else { return }
                if let error {
                    self.handleFailure(error, task: task)
                } else {
                    self.socketStatus = "接続しました"
                }
            }
        }
    }

    /// 中継からのメッセージは今は使わない。切れたことに気づくために受け続ける
    private func listen(_ task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            switch result {
            case .success:
                self?.listen(task)
            case .failure(let error):
                DispatchQueue.main.async { self?.handleFailure(error, task: task) }
            }
        }
    }

    /// 切れたら2秒後につなぎ直す
    private func handleFailure(_ error: Error, task: URLSessionWebSocketTask) {
        guard task === socket else { return } // 古い接続のエラーは無視
        socket = nil
        guard wantsConnection, let url = serverURL else { return }
        socketStatus = "切れました（\(error.localizedDescription)）。つなぎ直します…"
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.wantsConnection else { return }
            self.open(url)
        }
        retry = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: work)
    }

    // MARK: - 心拍を送る

    private func receive(_ bpm: Double) {
        heartRate = bpm
        lastReceivedAt = Date()
        guard let socket else { return }
        let text = "{\"bpm\":\(Int(bpm.rounded()))}"
        socket.send(.string(text)) { [weak self] error in
            DispatchQueue.main.async {
                if let error {
                    self?.socketStatus = "送れませんでした: \(error.localizedDescription)"
                } else {
                    self?.sentCount += 1
                }
            }
        }
    }

    /// Watch がなくても試せるように、2秒おきに 65〜95 の間でゆれる心拍を作る
    private func updateDummy() {
        dummyTimer?.invalidate()
        dummyTimer = nil
        guard useDummy else { return }
        var bpm = 75.0
        dummyTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            bpm = min(95, max(65, bpm + Double.random(in: -3...3)))
            self?.receive(bpm)
        }
    }

    private func updateWatchStatus(_ session: WCSession) {
        let status: String
        // つながっているなら、アプリは必ず入っている。先に見る（isWatchAppInstalled は遅れて変わることがある）
        if session.isReachable {
            status = "つながっています"
        } else if !session.isPaired {
            status = "ペアリングされていません"
        } else if !session.isWatchAppInstalled {
            status = "Watch にアプリが入っていません"
        } else {
            status = "Watch のアプリを開いてください"
        }
        DispatchQueue.main.async { self.watchStatus = status }
    }
}

// MARK: - WCSessionDelegate（Watch からの受け取り）

extension RelayModel: WCSessionDelegate {
    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        updateWatchStatus(session)
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        updateWatchStatus(session)
    }

    func sessionWatchStateDidChange(_ session: WCSession) {
        updateWatchStatus(session)
    }

    /// Watch から届く形: ["bpm": 心拍, "at": 測った時刻（1970年からの秒）]
    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        guard let bpm = message["bpm"] as? Double else { return }
        // アプリを閉じている間に置かれていた古い値などは、今の心拍として送らない
        if let at = message["at"] as? Double, Date().timeIntervalSince1970 - at > 10 { return }
        updateWatchStatus(session) // 届いたなら、表示も今の状態にそろえる
        DispatchQueue.main.async {
            // 2通りの送り方（sendMessage と applicationContext）で同じ値が2回届いたり、順番が入れ替わったりしたら捨てる
            if let at = message["at"] as? Double {
                if let last = self.lastMeasuredAt, at <= last { return }
                self.lastMeasuredAt = at
            }
            if !self.useDummy { self.receive(bpm) }
        }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        self.session(session, didReceiveMessage: applicationContext)
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        session.activate() // Watch を付け替えたときにつなぎ直す
    }
}
