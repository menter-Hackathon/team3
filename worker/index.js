// サーバー側（Cloudflare Worker）。/api/* だけここに来る。それ以外は画面のファイルが返る。
// API キーはここでだけ使う（ブラウザには渡さない）。
import Anthropic from "@anthropic-ai/sdk";
import { normalizeBlueprint } from "../src/blueprint.js";

const MODEL = "claude-opus-5-5"; // 安くしたいときは "claude-haiku-5-5"
const MAX_BODY_BYTES = 10_000;

const SYSTEM = `あなたは、体験した人の声・叩いたリズム・10の質問への答えから作られた1分の曲に、曲名と短い解説をつけます。
受け取るのは曲の設計図の数字だけです（bpm: 速さ、root と scale: 主音と音階、density: 音の多さ、sections: 1問ごとの盛り上がり energy・明るさ brightness・迷い hesitation。どれも 0〜1）。
- 曲名は日本語で20文字以内。解説は日本語で60文字以内。
- 曲の響きや流れを言葉にする。性格を言い当てたり「○○タイプ」に分類したりしない。`;

const TITLE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    comment: { type: "string" },
  },
  required: ["title", "comment"],
  additionalProperties: false,
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, ai: Boolean(env.ANTHROPIC_API_KEY) });
    }
    if (url.pathname === "/api/title" && request.method === "POST") {
      return handleTitle(request, env);
    }
    return Response.json({ error: "not found" }, { status: 404 });
  },
};

// 曲名と解説。キーがない・失敗したときは決まった文を返す（AI は任意）
async function handleTitle(request, env) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return Response.json({ error: "too large" }, { status: 413 });

  let input;
  try {
    input = JSON.parse(text);
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  // 設計図の数字だけを AI に渡す（自由な文章は通さない）
  const { bpm, root, scale, density, sections } = normalizeBlueprint(input);
  const summary = { bpm, root, scale, density, sections };

  if (!env.ANTHROPIC_API_KEY) return Response.json(fallback(summary));

  try {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: TITLE_SCHEMA },
      },
      messages: [{ role: "user", content: JSON.stringify(summary) }],
    });
    const block = response.content.find((b) => b.type === "text");
    const result = JSON.parse(block?.text ?? "");
    return Response.json({ title: result.title, comment: result.comment, ai: true });
  } catch (error) {
    console.error("title failed:", error instanceof Anthropic.APIError ? error.status : error);
    return Response.json(fallback(summary));
  }
}

function fallback({ bpm, root, scale }) {
  return { title: "あなたの曲", comment: `${bpm} BPM・${root} ${scale}`, ai: false };
}
