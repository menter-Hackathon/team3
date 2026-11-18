import SwiftUI

/// iPhone 側：Watch から届いた心拍を、中継サーバーに WebSocket で送る。
@main
struct HeartPhoneApp: App {
    @StateObject private var relay = RelayModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(relay)
        }
    }
}
