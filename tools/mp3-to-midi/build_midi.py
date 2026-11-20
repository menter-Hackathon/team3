"""④ 音符（秒）→ 全曲の細かい MIDI（full/<id>.mid）。

1. 秒 → 拍：analysis.json の拍の時刻の列で数える（拍と拍の間は線形）。テンポの揺れはここで消える
2. 検出の遅れの補正：パートごとに、音の位置が格子にそろうように一定のずれを引く（遅れは検出器・パートごとに違うため）
3. 格子（既定は16分音符）に合わせる。小さすぎる音・短すぎる音は消す
4. パートをトラックに割り当てる
     melody  単音（同じ時刻なら一番高い音・melodyMin 以上）。既定は vocals（歌が少なければ、いちばん高いパート）
             選ばれなかった音は元のパートの名前（keys など）で残す
     pad     和音（同じ時刻の音は padMaxVoices 個まで）。既定は和音が一番多いパート
     bass    単音（同じ時刻なら一番低い音）
     drums   ch10。キック36・スネア38・ハイハット閉42/開46・クラッシュ49・タム45/48
     それ以外 keys（piano）・guitar・synth（other）・sing（melody にしなかった vocals）。今のプロダクトでは鳴らない
   トラック名は src/music/parts.js の見分け方（pad/chord/string・melody/lead/vocal・bass・drum/perc）に合わせてある
5. 先頭に テンポ・4/4・"key: D dorian" のテキストを書く（src/music/edit/blueprintEdit.js が読む）
"""
from collections import defaultdict

import numpy as np
import pretty_midi

from common import FULL_DIR, song_dir, write_json

EXTRA_NAMES = {"vocals": "sing", "piano": "keys", "guitar": "guitar", "other": "synth"}
PROGRAMS = {"melody": 80, "pad": 89, "bass": 33, "keys": 0, "guitar": 27, "synth": 81, "sing": 52}  # General MIDI（0 始まり）
RESOLUTION = 480


def to_beats(times, beats):
    """秒 → 拍（小数）。拍の列の外は、端の拍の間隔で伸ばす。"""
    idx = np.arange(len(beats))
    t = np.asarray(times, dtype=float)
    pos = np.interp(t, beats, idx)
    head, tail = beats[1] - beats[0], beats[-1] - beats[-2]
    pos = np.where(t < beats[0], (t - beats[0]) / head, pos)
    pos = np.where(t > beats[-1], len(beats) - 1 + (t - beats[-1]) / tail, pos)
    return pos


def grid_offset(pos, weights, grid):
    """格子に一番よくそろう一定のずれ（格子の1目盛りを 1 として ±0.5 の範囲）と、そろった割合。"""
    x = pos * grid
    if len(x) == 0:
        return 0.0, 0.0
    ph = float(np.angle((np.exp(2j * np.pi * x) * weights).sum()) / (2 * np.pi))
    e = np.abs((x - ph) - np.round(x - ph))
    return ph, float(np.mean(e < 0.2))


def quantize_pitched(notes, beats, cfg):
    grid = cfg["grid"]
    if not notes:
        return [], {"offset": 0, "aligned": 0}
    s = to_beats([n["start"] for n in notes], beats)
    e = to_beats([n["end"] for n in notes], beats)
    amp = np.array([n["amp"] for n in notes])
    ph, aligned = grid_offset(s, amp, grid)
    out = []
    for n, a, b, v in zip(notes, s, e, amp):
        if v < cfg["minVelocity"] or (b - a) < cfg["minNoteBeats"]:
            continue
        start = int(round(a * grid - ph))
        end = max(start + 1, int(round(b * grid - ph)))
        if start < 0:
            continue
        out.append({"start": start, "end": end, "pitch": n["pitch"], "amp": float(v)})
    return merge_same_pitch(out), {"offset": round(ph / grid, 3), "aligned": round(aligned, 2)}


def merge_same_pitch(notes):
    """同じ高さで重なる音をつなぐ（Basic Pitch が長い音を細切れにすることがあるため）。"""
    by_pitch = defaultdict(list)
    for n in notes:
        by_pitch[n["pitch"]].append(n)
    out = []
    for group in by_pitch.values():
        group.sort(key=lambda n: n["start"])
        cur = dict(group[0])
        for n in group[1:]:
            if n["start"] < cur["end"]:
                cur["end"] = max(cur["end"], n["end"])
                cur["amp"] = max(cur["amp"], n["amp"])
            else:
                out.append(cur)
                cur = dict(n)
        out.append(cur)
    return sorted(out, key=lambda n: (n["start"], n["pitch"]))


def monophonic(notes, pick):
    """同じ時刻の音を1つにし（pick="high" なら一番高い音）、次の音の始まりで前の音を切る。"""
    by_start = defaultdict(list)
    for n in notes:
        by_start[n["start"]].append(n)
    chosen = [max(g, key=lambda n: n["pitch"]) if pick == "high" else min(g, key=lambda n: n["pitch"])
              for _, g in sorted(by_start.items())]
    for a, b in zip(chosen, chosen[1:]):
        a["end"] = min(a["end"], b["start"])
    return chosen


def limit_voices(notes, max_voices):
    by_start = defaultdict(list)
    for n in notes:
        by_start[n["start"]].append(n)
    out = []
    for g in by_start.values():
        out += sorted(g, key=lambda n: -n["amp"])[:max_voices]
    return sorted(out, key=lambda n: (n["start"], n["pitch"]))


def quantize_drums(hits, beats, cfg):
    grid = cfg["grid"]
    if not hits:
        return [], {"offset": 0, "aligned": 0}
    pos = to_beats([h["time"] for h in hits], beats)
    amp = np.array([h["amp"] for h in hits])
    ph, aligned = grid_offset(pos, amp, grid)
    seen = {}
    for h, p in zip(hits, pos):
        step = int(round(p * grid - ph))
        if step < 0:
            continue
        key = (step, h["note"])
        if key not in seen or seen[key]["amp"] < h["amp"]:
            seen[key] = {"start": step, "end": step + 1, "pitch": h["note"], "amp": h["amp"]}
    return sorted(seen.values(), key=lambda n: (n["start"], n["pitch"])), {"offset": round(ph / grid, 3), "aligned": round(aligned, 2)}


def chord_onsets(notes):
    count = defaultdict(int)
    for n in notes:
        count[n["start"]] += 1
    return sum(1 for c in count.values() if c >= 2)


def assign_roles(q, cfg, bars, db):
    """パート → トラック名。

    melody: 歌がはっきり入っている（ほかの一番大きいパートとの差が 12 dB 以内で、1小節に3音以上）なら vocals。
            そうでなければ、音の多いパートのうち音の高さの中央値が一番高いもの
    pad:    残りのうち、和音（同じ時刻に2音以上）が一番多いもの
    """
    candidates = [s for s in ("vocals", "guitar", "piano", "other") if len(q[s]) >= bars]
    loudest = max(db[s] for s in ("guitar", "piano", "other", "vocals"))
    melody = cfg["melody"]
    if melody == "auto":
        if len(q["vocals"]) >= bars * 3 and db["vocals"] >= loudest - 12:
            melody = "vocals"
        else:
            rest = [s for s in candidates if s != "vocals"] or candidates
            melody = max(rest, key=lambda s: np.median([n["pitch"] for n in q[s]])) if rest else None
    pad = cfg["pad"]
    if pad == "auto":
        rest = [s for s in candidates if s not in (melody, "vocals")]
        pad = max(rest, key=lambda s: chord_onsets(q[s])) if rest else None
    roles = {}
    if melody:
        roles[melody] = "melody"
    if pad and pad != melody:
        roles[pad] = "pad"
    roles["bass"] = "bass"
    for s in ("vocals", "guitar", "piano", "other"):
        roles.setdefault(s, EXTRA_NAMES[s])
    return roles


def velocity(amps):
    """強さ（0〜1）→ MIDI の velocity。トラックの中で 95% 点を 115 にそろえる。"""
    amps = np.asarray(amps, dtype=float)
    if len(amps) == 0:
        return amps
    ref = np.percentile(amps, 95) + 1e-9
    return np.clip(np.round(30 + 85 * amps / ref), 1, 127).astype(int)


def build_midi(cfg, analysis, notes, db):
    song_id = cfg["id"]
    beats = np.array(analysis["beats"])
    bars = analysis["bars"]
    grid = cfg["grid"]
    bpm = float(round(analysis["bpm"]))
    step_sec = 60.0 / bpm / grid

    q, stats = {}, {}
    for stem, ns in notes.items():
        if stem == "drums":
            q[stem], stats[stem] = quantize_drums(ns, beats, cfg)
        else:
            q[stem], stats[stem] = quantize_pitched(ns, beats, cfg)
    roles = assign_roles(q, cfg, bars, db)

    pm = pretty_midi.PrettyMIDI(resolution=RESOLUTION, initial_tempo=bpm)
    pm.time_signature_changes.append(pretty_midi.TimeSignature(4, 4, 0))
    key = analysis["key"]
    pm.text_events.append(pretty_midi.Text(f"key: {key['root']} {key['scale']}", 0))
    tracks = {}
    order = ["melody", "pad", "bass", "drums", "keys", "guitar", "synth", "sing"]
    for stem, ns in q.items():
        name = "drums" if stem == "drums" else roles[stem]
        if name == "melody":
            # 一番高い音の流れだけを melody にする。下限より低い音と、選ばれなかった音は、元のパートの名前で残す
            top = monophonic([n for n in ns if n["pitch"] >= cfg["melodyMin"]], "high")
            chosen = {(n["start"], n["pitch"]) for n in top}
            rest = limit_voices([n for n in ns if (n["start"], n["pitch"]) not in chosen], cfg["padMaxVoices"])
            if rest:
                tracks[EXTRA_NAMES[stem]] = (stem, rest)
            ns = top
        elif name == "bass":
            ns = monophonic(ns, "low")
        elif name != "drums":
            ns = limit_voices(ns, cfg["padMaxVoices"])
        if ns:
            tracks[name] = (stem, ns)
    report = {"bpm": bpm, "bars": bars, "key": f"{key['root']} {key['scale']}", "tracks": {}}
    for name in sorted(tracks, key=order.index):
        stem, ns = tracks[name]
        inst = pretty_midi.Instrument(program=0 if name == "drums" else PROGRAMS[name], is_drum=name == "drums", name=name)
        for n, v in zip(ns, velocity([n["amp"] for n in ns])):
            inst.notes.append(pretty_midi.Note(velocity=int(v), pitch=int(n["pitch"]), start=n["start"] * step_sec, end=n["end"] * step_sec))
        pm.instruments.append(inst)
        pitches = [n["pitch"] for n in ns]
        report["tracks"][name] = {
            "from": stem, "notes": len(ns), "range": [min(pitches), max(pitches)], **stats[stem],
            # 最後の小節の終わりぎりぎりの音が、格子に合わせて次の小節に入ることがあるので、最後の小節に入れて長さをそろえる
            "perBar": np.bincount([min(n["start"] // (grid * 4), bars - 1) for n in ns], minlength=bars)[:bars].tolist(),
        }
    FULL_DIR.mkdir(exist_ok=True)
    out = FULL_DIR / f"{song_id}.mid"
    pm.write(str(out))
    write_json(song_dir(song_id) / "report.json", report)
    print(f"[{song_id}] ④ {out.relative_to(FULL_DIR.parent)}（{bars} 小節・{bpm:g} BPM・key: {report['key']}）")
    for name, t in report["tracks"].items():
        print(f"[{song_id}]    {name:<7}← {t['from']:<7}{t['notes']:>5} 音  音域 {t['range'][0]}〜{t['range'][1]}  "
              f"格子にそろった割合 {t['aligned']:.2f}（補正 {t['offset']:+.3f} 拍）")
    return report


def print_bar_map(song_id, report, width=4):
    """何小節目にどのパートがどれくらい鳴っているか（切り出す区間を選ぶ目安）。"""
    names = [n for n in ("melody", "pad", "bass", "drums") if n in report["tracks"]]
    print(f"[{song_id}]    小節ごとの音の数（{width}小節ずつ）: " + " / ".join(names))
    bars = report["bars"]
    for b in range(0, bars, width):
        cells = []
        for n in names:
            per = report["tracks"][n]["perBar"]
            cells.append(f"{sum(per[b:b + width]):4d}")
        print(f"[{song_id}]      {b:3d}〜{min(bars, b + width) - 1:3d}小節 " + " ".join(cells))
