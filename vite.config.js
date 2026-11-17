import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// 画面（index.html と src/）は Vite、サーバー処理（worker/）は Cloudflare Worker。
// npm run dev で両方がいっしょに動く。
export default defineConfig({
  plugins: [cloudflare()],
});
