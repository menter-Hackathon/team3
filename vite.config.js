import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// 画面（index.html と src/）は Vite、サーバー処理（worker/）は Cloudflare Worker。
// npm run dev で両方がいっしょに動く。
export default defineConfig({
  plugins: [cloudflare()],
  server: {
    // 同じネットワークの iPhone から「Mac の名前.local」でつなげるようにする（心拍の中継を手元で試すとき）。
    // iPhone は IP アドレスへの暗号化しない通信（ws://）を止めることがあるが、.local の名前なら通る
    allowedHosts: [".local"],
  },
});
