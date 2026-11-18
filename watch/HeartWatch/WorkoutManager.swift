import Foundation
import HealthKit
import WatchConnectivity

/// 心拍を測って iPhone に送る。
/// ワークアウト（HKWorkoutSession）を動かしている間だけ、数秒おきに心拍が届く。
/// 測ったデータは Health に保存しない（止めたらワークアウトごと破棄する）。
/// iPhone に送る形: ["bpm": 心拍, "at": 測った時刻（1970年からの秒）]
/// 画面に出す値はメインスレッド（@MainActor）でだけ変える。タイマーやデリゲートからは Task { @MainActor in } で戻すので、
/// クロージャにつかまえても安全（@unchecked Sendable）。
final class WorkoutManager: NSObject, ObservableObject, @unchecked Sendable {
    @Published var heartRate: Double?
    @Published var isRunning = false
    @Published var isStarting = false
    @Published var status = "停止中"
    @Published var phoneReachable = false

    private let healthStore = HKHealthStore()
    private let heartRateType = HKQuantityType(.heartRate)
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var lastHeartRateAt: Date?
    private var watchdog: Timer?
    private var dummyTimer: Timer?

    /// 開発用: 起動引数 -dummyHeart YES で、センサーの代わりにダミーの心拍を作る（シミュレーターで試す用）
    private var usesDummy: Bool {
        #if DEBUG
        return UserDefaults.standard.bool(forKey: "dummyHeart")
        #else
        return false
        #endif
    }

    override init() {
        super.init()
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
    }

    // MARK: - 測る・止める

    @MainActor
    func start() async {
        guard !isRunning, !isStarting else { return } // 2回押されても1回だけ始める
        isStarting = true
        defer { isStarting = false }

        if usesDummy {
            startDummy()
            return
        }
        guard HKHealthStore.isHealthDataAvailable() else {
            status = "この端末ではヘルスケアが使えません"
            return
        }
        do {
            try await healthStore.requestAuthorization(toShare: [HKObjectType.workoutType()], read: [heartRateType])

            let configuration = HKWorkoutConfiguration()
            configuration.activityType = .mindAndBody
            configuration.locationType = .indoor

            let session = try HKWorkoutSession(healthStore: healthStore, configuration: configuration)
            let builder = session.associatedWorkoutBuilder()
            builder.dataSource = HKLiveWorkoutDataSource(healthStore: healthStore, workoutConfiguration: configuration)
            session.delegate = self
            builder.delegate = self
            self.session = session
            self.builder = builder

            let startDate = Date()
            session.startActivity(with: startDate)
            try await builder.beginCollection(at: startDate)
            isRunning = true
            status = "測定中"
            startWatchdog()
        } catch {
            status = "開始できませんでした: \(error.localizedDescription)"
        }
    }

    @MainActor
    func stop() {
        if dummyTimer != nil {
            dummyTimer?.invalidate()
            dummyTimer = nil
            finishStopping()
            return
        }
        session?.end()
    }

    @MainActor
    private func finishStopping() {
        watchdog?.invalidate()
        watchdog = nil
        isRunning = false
        heartRate = nil
        lastHeartRateAt = nil
        status = "停止中"
        session = nil
        builder = nil
    }

    /// ヘルスケアの許可が拒否されていると、心拍は届かないのにエラーにもならない。15秒届かなければ知らせる
    @MainActor
    private func startWatchdog() {
        watchdog?.invalidate()
        let startedAt = Date()
        watchdog = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.isRunning else { return }
                let last = self.lastHeartRateAt ?? startedAt
                if Date().timeIntervalSince(last) > 15 {
                    self.status = "心拍が届きません。Watch をしっかり着けて、設定 > ヘルスケアで心拍の許可を確認してください"
                }
            }
        }
    }

    @MainActor
    private func startDummy() {
        var bpm = 72.0
        isRunning = true
        status = "測定中（ダミー）"
        startWatchdog()
        dummyTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            bpm = min(110, max(60, bpm + Double.random(in: -3...3)))
            let value = bpm
            Task { @MainActor in self?.received(value) }
        }
    }

    // MARK: - 届いた心拍を iPhone に送る

    @MainActor
    private func received(_ bpm: Double) {
        heartRate = bpm
        lastHeartRateAt = Date()
        if status != "測定中", status != "測定中（ダミー）" {
            status = usesDummy ? "測定中（ダミー）" : "測定中"
        }
        send(bpm)
    }

    /// iPhone のアプリが開いていれば sendMessage。開いていない・失敗したときは、最新の値だけを applicationContext に置く
    private func send(_ bpm: Double) {
        let session = WCSession.default
        guard session.activationState == .activated else { return }
        let message: [String: Any] = ["bpm": bpm, "at": Date().timeIntervalSince1970]
        if session.isReachable {
            session.sendMessage(message, replyHandler: nil) { _ in
                try? session.updateApplicationContext(message)
            }
        } else {
            try? session.updateApplicationContext(message)
        }
    }
}

// MARK: - HKWorkoutSessionDelegate

extension WorkoutManager: HKWorkoutSessionDelegate {
    func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState,
                        from fromState: HKWorkoutSessionState, date: Date) {
        guard toState == .ended else { return }
        builder?.endCollection(withEnd: date) { [weak self] _, _ in
            self?.builder?.discardWorkout() // Health に保存しない
            Task { @MainActor in self?.finishStopping() }
        }
    }

    func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        Task { @MainActor in
            self.finishStopping()
            self.status = "止まりました: \(error.localizedDescription)"
        }
    }
}

// MARK: - HKLiveWorkoutBuilderDelegate

extension WorkoutManager: HKLiveWorkoutBuilderDelegate {
    func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
        guard collectedTypes.contains(heartRateType),
              let quantity = workoutBuilder.statistics(for: heartRateType)?.mostRecentQuantity() else { return }
        let bpm = quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
        Task { @MainActor in self.received(bpm) }
    }

    func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}
}

// MARK: - WCSessionDelegate

extension WorkoutManager: WCSessionDelegate {
    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        DispatchQueue.main.async { self.phoneReachable = session.isReachable }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async { self.phoneReachable = session.isReachable }
    }
}
