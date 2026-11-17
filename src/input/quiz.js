// 【入力1】性格診断 TIPI-J（10問・5段階）。
// 文言は原典（小塩・阿部・カトローニ, 2012, パーソナリティ研究）で確認すること。
// 性格の「タイプ分け」はしない。数字は曲の材料にだけ使う。

export const QUESTIONS = [
  { text: "活発で、外向的だと思う", trait: "extraversion", reverse: false },
  { text: "他人に不満をもち、もめごとを起こしやすいと思う", trait: "agreeableness", reverse: true },
  { text: "しっかりしていて、自分に厳しいと思う", trait: "conscientiousness", reverse: false },
  { text: "心配性で、うろたえやすいと思う", trait: "neuroticism", reverse: false },
  { text: "新しいことが好きで、変わった考えをもつと思う", trait: "openness", reverse: false },
  { text: "ひかえめで、おとなしいと思う", trait: "extraversion", reverse: true },
  { text: "人に気をつかう、やさしい人間だと思う", trait: "agreeableness", reverse: false },
  { text: "だらしなく、うっかりしていると思う", trait: "conscientiousness", reverse: true },
  { text: "冷静で、気分が安定していると思う", trait: "neuroticism", reverse: true },
  { text: "発想力に欠けた、平凡な人間だと思う", trait: "openness", reverse: true },
];

// 1〜5 の順
export const CHOICES = [
  "全く違うと思う",
  "少し違うと思う",
  "どちらでもない",
  "少しそう思う",
  "強くそう思う",
];

// 選んだ選択肢ごとに足す重み（CHOICES と同じ順）。真ん中は 0。逆転項目は符号を逆にして足す。
export const CHOICE_WEIGHTS = [-2, -1, 0, 1, 2];

// answers: [{ value: 1〜5, ms: 答えるまでの時間 }] × 10（無い・範囲外は「どちらでもない」）
// → 5つの特性それぞれ 0〜1（2問の重みの合計 -4〜4 を 0〜1 にしたもの。0.5 が中間）
export function scoreQuiz(answers) {
  const sums = { extraversion: 0, agreeableness: 0, conscientiousness: 0, neuroticism: 0, openness: 0 };
  const maxSum = 2 * Math.max(...CHOICE_WEIGHTS.map(Math.abs)); // 1つの特性は2問
  QUESTIONS.forEach((q, i) => {
    const weight = CHOICE_WEIGHTS[Math.round(answers?.[i]?.value) - 1] ?? 0;
    sums[q.trait] += q.reverse ? -weight : weight;
  });
  return Object.fromEntries(Object.entries(sums).map(([trait, sum]) => [trait, (sum / maxSum + 1) / 2]));
}
