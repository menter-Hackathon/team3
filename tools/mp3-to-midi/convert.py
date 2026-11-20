"""原曲の MP3 → MIDI。①〜⑤ を順に実行する入口。

  .venv/bin/python convert.py song1            # 1曲
  .venv/bin/python convert.py --all            # songs.json の全曲
  .venv/bin/python convert.py song1 --start-bar 16   # 切り出す区間だけ試す（songs.json は書き換えない）

① 分離（separate.py）→ ② 解析（analyze.py）→ ③ 採譜（transcribe.py）→ ④ 全曲 MIDI（build_midi.py）→ ⑤ 48 小節（excerpt.py）
① と ③ は結果を work/ に残し、次からは飛ばす（--force-separate / --force-transcribe でやり直す）。
"""
import argparse
import warnings

warnings.filterwarnings("ignore")

from analyze import analyze  # noqa: E402
from build_midi import build_midi, print_bar_map  # noqa: E402
from common import all_song_ids, load_config  # noqa: E402
from excerpt import excerpt  # noqa: E402
from separate import separate  # noqa: E402
from transcribe import transcribe  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description="原曲の MP3 → MIDI")
    ap.add_argument("songs", nargs="*", help="song1 など（songs.json のキー）")
    ap.add_argument("--all", action="store_true", help="songs.json の全曲")
    ap.add_argument("--start-bar", type=int, help="切り出す最初の小節（0 始まり。1曲のときだけ）")
    ap.add_argument("--force-separate", action="store_true", help="① の分離をやり直す")
    ap.add_argument("--force-transcribe", action="store_true", help="③ の採譜をやり直す")
    args = ap.parse_args()
    ids = all_song_ids() if args.all else args.songs
    if not ids:
        ap.error("曲を指定してください（例: song1 / --all）")
    if args.start_bar is not None and len(ids) != 1:
        ap.error("--start-bar は1曲のときだけ使えます")
    for song_id in ids:
        cfg = load_config(song_id)
        if args.start_bar is not None:
            cfg["startBar"] = args.start_bar
        separate(cfg, force=args.force_separate)
        analysis = analyze(cfg)
        notes, levels = transcribe(cfg, force=args.force_transcribe)
        report = build_midi(cfg, analysis, notes, levels)
        print_bar_map(song_id, report)
        excerpt(cfg, report)
        print()


if __name__ == "__main__":
    main()
