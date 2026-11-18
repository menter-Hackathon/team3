import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var workout: WorkoutManager

    var body: some View {
        // 小さい画面（40mm など）でもはみ出さないように、全体をスクロールできるようにする
        ScrollView {
            VStack(spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Image(systemName: "heart")
                        .foregroundStyle(.pink)
                    Text(workout.heartRate.map { "\(Int($0.rounded()))" } ?? "--")
                        .font(.system(size: 44, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                    Text("BPM")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                Text(workout.status)
                    .font(.footnote)
                    .multilineTextAlignment(.center)
                Text(workout.phoneReachable ? "iPhone とつながっています" : "iPhone のアプリを開いてください")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                Button(workout.isRunning ? "止める" : "測る") {
                    if workout.isRunning {
                        workout.stop()
                    } else {
                        Task { await workout.start() }
                    }
                }
                .tint(workout.isRunning ? .gray : .pink)
                .disabled(workout.isStarting)
            }
        }
        #if DEBUG
        // 開発用: 起動引数 -autoStart YES で、画面を触らずに測り始める
        .task {
            if UserDefaults.standard.bool(forKey: "autoStart") { await workout.start() }
        }
        #endif
    }
}
