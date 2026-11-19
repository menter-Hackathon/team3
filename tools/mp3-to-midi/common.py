"""共通：パス・設定・JSON の読み書き。"""
import json
from pathlib import Path

TOOL_DIR = Path(__file__).resolve().parent
REPO_DIR = TOOL_DIR.parent.parent
WORK_DIR = TOOL_DIR / "work"  # 途中のファイル（git に入れない）
FULL_DIR = TOOL_DIR / "full"  # 全曲の細かい MIDI（git に入れる）
SONGS_DIR = REPO_DIR / "public" / "songs"  # プロダクトが読む 48 小節の原曲（compose が頭から必要な小節だけ使う）

STEMS = ["vocals", "drums", "bass", "guitar", "piano", "other"]  # Demucs htdemucs_6s の6つ
PITCHED_STEMS = [s for s in STEMS if s != "drums"]
SCALE_NAMES = ["phrygian", "aeolian", "dorian", "mixolydian", "ionian", "lydian"]  # src/blueprint.js の SCALES と同じ
SCALES = {
    "phrygian": [0, 1, 3, 5, 7, 8, 10],
    "aeolian": [0, 2, 3, 5, 7, 8, 10],
    "dorian": [0, 2, 3, 5, 7, 9, 10],
    "mixolydian": [0, 2, 4, 5, 7, 9, 10],
    "ionian": [0, 2, 4, 5, 7, 9, 11],
    "lydian": [0, 2, 4, 6, 7, 9, 11],
}
NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]  # 主音はシャープだけ（interfaces.md の 6）
SONG_BARS = 48  # 切り出す長さ。compose が約1分になるように頭から必要な小節だけ使う（160 BPM で40小節。余裕を見て48）


def load_config(song_id):
    """songs.json の defaults に曲ごとの設定を重ねたもの。"""
    data = json.loads((TOOL_DIR / "songs.json").read_text(encoding="utf-8"))
    if song_id not in data["songs"]:
        raise SystemExit(f"songs.json に {song_id} がありません（{', '.join(data['songs'])}）")
    cfg = {**data["defaults"], **data["songs"][song_id], "id": song_id}
    cfg["sourcePath"] = Path(data["sourceDir"]).expanduser() / cfg["source"]
    return cfg


def all_song_ids():
    data = json.loads((TOOL_DIR / "songs.json").read_text(encoding="utf-8"))
    return list(data["songs"])


def song_dir(song_id):
    d = WORK_DIR / song_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def stem_path(song_id, stem):
    return WORK_DIR / song_id / "htdemucs_6s" / f"{stem}.wav"


def read_json(path, default=None):
    path = Path(path)
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def write_json(path, data):
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
