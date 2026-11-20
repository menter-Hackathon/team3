"""① MP3 → 楽器ごとの WAV（Demucs htdemucs_6s：vocals / drums / bass / guitar / piano / other）。

結果は work/<id>/htdemucs_6s/<stem>.wav。すでにあれば何もしない（--force でやり直す）。
"""
import subprocess
import sys

import torch

from common import STEMS, song_dir, stem_path


def separate(cfg, force=False):
    song_id = cfg["id"]
    if not force and all(stem_path(song_id, s).exists() for s in STEMS):
        print(f"[{song_id}] ① 分離済みなので飛ばします")
        return
    if not cfg["sourcePath"].exists():
        raise SystemExit(f"MP3 が見つかりません: {cfg['sourcePath']}")
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"[{song_id}] ① Demucs で分離します（{device}。数分かかります）")
    subprocess.run(
        [sys.executable, "-m", "demucs", "-n", "htdemucs_6s", "-d", device,
         "-o", str(song_dir(song_id)), "--filename", "{stem}.{ext}", str(cfg["sourcePath"])],
        check=True,
    )
