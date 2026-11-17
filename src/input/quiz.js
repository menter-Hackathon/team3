// 【入力1】性格診断 TIPI-J（10問・7段階）。
//
// 書くもの:
//   QUESTIONS: 10問。{ text: 質問文, trait: 5つの特性のどれか, reverse: 逆転項目か }
//   CHOICES:   7段階の選択肢（1〜7 の順）
//   scoreQuiz(answers) → { extraversion, agreeableness, conscientiousness, neuroticism, openness }（各 0〜1）
//     answers は [{ value: 1〜7, ms: 答えるまでの時間 }] × 10
//
// 参考:
//   質問文と選択肢は原典（小塩・阿部・カトローニ, 2012, パーソナリティ研究）のものを使う
//   例: { text: "活発で、外向的だと思う", trait: "extraversion", reverse: false }
//   1つの特性につき2問（うち1問は逆転項目）。逆転項目は 8 - value にして足す
//   → 合計は 2〜14 → (合計 - 2) / 12 で 0〜1 にする
//   タイプ分けはしない。数字は曲の材料にだけ使う

export const QUESTIONS = []; // TODO(入力1)

export const CHOICES = []; // TODO(入力1)

export function scoreQuiz(answers) {
  // TODO(入力1)
  return null;
}
