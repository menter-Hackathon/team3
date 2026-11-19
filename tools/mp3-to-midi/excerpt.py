"""⑤ 全曲の MIDI（full/<id>.mid）→ 48 小節の原曲（public/songs/<id>.mid）。

startBar（0 始まり）から 48 小節（SONG_BARS）を切り出し、その小節の頭を tick 0 にする。区間の外にはみ出す音は区間の終わりで切る。
startBar を書いていないときは、melody・pad・bass・drums が一番そろって鳴っている区間を仮に選ぶ。
"""
import numpy as np
import pretty_midi

from common import FULL_DIR, SONG_BARS, SONGS_DIR

CORE = ("melody", "pad", "bass", "drums")


def suggest_start(report):
    """4つのパートが全部鳴っている小節が一番多い区間（同じなら音の多いほう）。"""
    bars = report["bars"]
    if bars <= SONG_BARS:
        return 0
    per = np.array([report["tracks"][n]["perBar"] if n in report["tracks"] else [0] * bars for n in CORE])
    full = (per > 0).all(axis=0).astype(float)
    total = per.sum(axis=0)
    scores = [(full[s:s + SONG_BARS].sum(), total[s:s + SONG_BARS].sum(), -s) for s in range(0, bars - SONG_BARS + 1, 2)]
    return -max(scores)[2]


def excerpt(cfg, report):
    song_id = cfg["id"]
    start_bar = cfg.get("startBar")
    auto = start_bar is None
    if auto:
        start_bar = suggest_start(report)
    full = pretty_midi.PrettyMIDI(str(FULL_DIR / f"{song_id}.mid"))
    bpm = full.get_tempo_changes()[1][0]
    bar_sec = 4 * 60.0 / bpm
    t0, t1 = start_bar * bar_sec, (start_bar + SONG_BARS) * bar_sec
    eps = 1e-6

    pm = pretty_midi.PrettyMIDI(resolution=full.resolution, initial_tempo=bpm)
    pm.time_signature_changes.append(pretty_midi.TimeSignature(4, 4, 0))
    pm.text_events += [pretty_midi.Text(t.text, 0) for t in full.text_events if t.text.startswith("key:")]
    for src in full.instruments:
        inst = pretty_midi.Instrument(program=src.program, is_drum=src.is_drum, name=src.name)
        for n in src.notes:
            if t0 - eps <= n.start < t1 - eps:
                inst.notes.append(pretty_midi.Note(n.velocity, n.pitch, max(0.0, n.start - t0), min(n.end, t1) - t0))
        if inst.notes:
            pm.instruments.append(inst)
    SONGS_DIR.mkdir(parents=True, exist_ok=True)
    out = SONGS_DIR / f"{song_id}.mid"
    pm.write(str(out))
    counts = ", ".join(f"{i.name} {len(i.notes)}" for i in pm.instruments)
    how = "仮に自動で選んだ区間。songs.json の startBar で変えられます" if auto else "songs.json の startBar"
    print(f"[{song_id}] ⑤ public/songs/{out.name}：{start_bar}〜{start_bar + SONG_BARS - 1} 小節目（{how}）")
    print(f"[{song_id}]    {counts}")
    return start_bar
