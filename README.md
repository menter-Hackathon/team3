# team3

メンターハッカソン チーム3 のリポジトリです。テーマは「らしさ」。作品の内容は [docs/PRODUCT.md](docs/PRODUCT.md) にあります。

## Claude Code のセットアップ（clone したら最初に1回）

1. リポジトリを clone する
   ```bash
   git clone https://github.com/menter-Hackathon/team3.git
   cd team3
   ```
2. このフォルダで Claude Code を起動し、`/mentor-hackathon-setup` を実行する
   - `CLAUDE.md`（チームの開発ルール）と `CLAUDE.local.md`（個人設定）が作られる。どちらもコミットされない
3. Claude Code を再起動する（設定とフックはセッション開始時に読まれる）
4. 個人の好み（説明の詳しさなど）は `CLAUDE.local.md` に、作品・技術の情報は `docs/PRODUCT.md` に書く

ルールのテンプレートが更新されたら（pull したあとなど）、もう一度 `/mentor-hackathon-setup` を実行してください。

## ルールの要点

- main に直接 push しない。`feature/〇〇`・`fix/〇〇`・`change/〇〇` のブランチを切って、main への PR を出す
- merge の前に、メンバーの目視か `/code-review` でレビューする
- コミットメッセージは英語・命令形・1行（例: `Add voice recorder`）
- `.env`・`.dev.vars` などの秘密の値はコミットしない。`.env.example`・`.dev.vars.example` にダミーの値を書く
- 体験者の声・顔・心拍のデータはリポジトリに入れない

全文は `.claude/skills/mentor-hackathon-setup/templates/CLAUDE.md` にあります。

## 入っているもの

- `.claude/settings.json`: チーム共通の権限設定（機密ファイルの読み取り禁止、生成物を読まない、危険なコマンドの禁止など）
- `.claude/hooks/guard.py`: 機密ファイルへのアクセス・main への push・force push を止めるフック（`python3 .claude/hooks/guard.py --self-test` で動作確認できる）
- `.claude/skills/mentor-hackathon-setup/`: セットアップ用のスキルとテンプレート（ルールの正本）
- `CLAUDE.local.md.example`: 個人設定の雛形
- `docs/PRODUCT.md`: 作品と技術の情報
