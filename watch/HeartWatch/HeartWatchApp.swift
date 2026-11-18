import SwiftUI

/// Apple Watch 側：心拍を測って iPhone に送る。
@main
struct HeartWatchApp: App {
    @StateObject private var workout = WorkoutManager()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(workout)
        }
    }
}
