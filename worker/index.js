// サーバー側（Cloudflare Worker）。/api/* だけここに来る。それ以外は画面のファイルが返る。
// API キーはここでだけ使う（ブラウザに渡さない）。キーは env.ANTHROPIC_API_KEY
// （手元は .dev.vars、本番は npx wrangler secret put ANTHROPIC_API_KEY）。
//
// 受け渡しの形は docs/interfaces.md の「8. サーバー・アプリとのやり取り」。
//
// 書くもの:
//   POST /api/title  設計図を受け取り、AI で曲名と短い解説を返す
//     → 200 { title: 20字以内, comment: 60字以内, ai: true }
//     キーがない・失敗したときも 200 で、決まった曲名と ai: false を返す（曲は AI なしで聞けるようにする）
//     JSON が壊れているときは 400、10KB を超えるときは 413
//
// 参考（Claude API）:
//   import Anthropic from "@anthropic-ai/sdk";
//   const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
//   const response = await client.messages.create({
//     model: "claude-opus-5-5",  // 安くするなら "claude-haiku-5-5"
//     max_tokens: 2000,
//     system: "曲名と解説のルール（性格を言い当てたり、タイプ分けしたりしない）",
//     output_config: { format: { type: "json_schema", schema: { /* title と comment の形 */ } } },
//     messages: [{ role: "user", content: JSON.stringify(設計図の数字) }],
//   });
//   const text = response.content.find((b) => b.type === "text")?.text; // JSON の文字列
//   自由な文章は AI に渡さない（設計図の数字だけ）。公開する前に、呼べる回数の制限を考える

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return Response.json({ ok: true });
    }
    // TODO: POST /api/title
    return Response.json({ error: "not found" }, { status: 404 });
  },
};
