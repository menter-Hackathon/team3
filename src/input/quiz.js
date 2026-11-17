// 【入力1】性格診断 TIPI-J（10問・7段階）。
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

// 1〜7 の順
export const CHOICES = [
  "全く違うと思う",
  "おおよそ違うと思う",
  "少し違うと思う",
  "どちらでもない",
  "少しそう思う",
  "まあまあそう思う",
  "強くそう思う",
];

// answers: [{ value: 1〜7, ms: 答えるまでの時間 }] × 10
// → 5つの特性それぞれ 0〜1（2問の合計 2〜14 を 0〜1 にしたもの）
export function scoreQuiz(answers) {
  const sums = { extraversion: 0, agreeableness: 0, conscientiousness: 0, neuroticism: 0, openness: 0 };
  QUESTIONS.forEach((q, i) => {
    const value = answers[i]?.value ?? 4;
    sums[q.trait] += q.reverse ? 8 - value : value;
  });
  return Object.fromEntries(Object.entries(sums).map(([trait, sum]) => [trait, (sum - 2) / 12]));
}
