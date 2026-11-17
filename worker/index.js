// サーバー側（Cloudflare Worker）。/api/* だけここに来る。それ以外は画面のファイルが返る。
// API キーはここでだけ使う（ブラウザに渡さない）。キーは env.ANTHROPIC_API_KEY
// （手元は .dev.vars、本番は npx wrangler secret put ANTHROPIC_API_KEY）。
//
// 書くもの:
//   POST /api/title  設計図（数字だけ）を受け取り、AI で曲名と短い解説を返す → { title, comment }
//     キーがない・失敗したときも、決まった曲名を返す（AI は任意。曲は AI なしで聞けるようにする）
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
