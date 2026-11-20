"""③ 採譜：楽器ごとの WAV → 音符（秒のまま。拍に合わせるのは build_midi.py）。

  音程のあるパート（vocals / bass / guitar / piano / other）: Basic Pitch（Spotify）。和音も取れる
    → [{"start", "end", "pitch"(MIDI 番号), "amp"(0〜1)}]
  drums: 音の出始めを見つけ、帯域ごとのエネルギーの増え方と残り方で分類する（1つの出始めが複数の音になることもある）
    → [{"time", "note"(General MIDI), "amp"}]

transcribe() → (パートごとの音符, パートごとの音量 dB)。結果は work/<id>/notes/<stem>.json。設定（しきい値など）が同じなら前の結果を使う。
ほとんど音のないパート（-50 dB 未満）は採譜しない（ほかの楽器のもれを拾って、でたらめな音符になるため）。
"""
import librosa
import numpy as np
import soundfile as sf

from common import PITCHED_STEMS, read_json, song_dir, stem_path, write_json

SILENT_DB = -50
# パートごとに採る音の高さの範囲（Hz）。範囲の外の倍音などを拾わないように
FREQ_RANGE = {
    "vocals": (80, 1400),
    "bass": (28, 400),
    "guitar": (70, 2500),
    "piano": (27, 4200),
    "other": (50, 4200),
}
# Basic Pitch の一番短い音（ms）。ベースは短い音のノイズが多いので長めにする
MIN_NOTE_MS = {"bass": 90, "vocals": 90}

SR = 44100
HOP = 128
# ドラムの分類で使う General MIDI の番号
KICK, SNARE, HAT_CLOSED, HAT_OPEN, CRASH, TOM_LOW, TOM_HIGH = 36, 38, 42, 46, 49, 45, 48

_model = None


def stem_db(song_id, stem):
    data, _ = sf.read(stem_path(song_id, stem))
    return 20 * np.log10(np.sqrt(np.mean(data ** 2)) + 1e-9)


def pitched_notes(song_id, stem, cfg):
    global _model
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import Model, predict

    if _model is None:
        _model = Model(ICASSP_2022_MODEL_PATH)
    lo, hi = FREQ_RANGE[stem]
    _, _, events = predict(
        str(stem_path(song_id, stem)), _model,
        onset_threshold=cfg["onsetThreshold"], frame_threshold=cfg["frameThreshold"],
        minimum_note_length=MIN_NOTE_MS.get(stem, 60), minimum_frequency=lo, maximum_frequency=hi,
        multiple_pitch_bends=False, melodia_trick=True,
    )
    notes = [{"start": round(float(s), 4), "end": round(float(e), 4), "pitch": int(p), "amp": round(float(a), 3)}
             for s, e, p, a, _ in events]
    return sorted(notes, key=lambda n: (n["start"], n["pitch"]))


def drum_hits(song_id, cfg):
    """ドラムの WAV → 打楽器ごとの音。

    帯域ごとに別々に音の出始めを探す（キックとハイハットが同時に鳴っても、両方取れるように）。
    見つけた音は、その瞬間に各帯域のエネルギーがどれだけ増えたか・どれだけ残るかで仕分ける。
      キック 30〜120Hz / タム・スネアの胴 120〜400Hz / スネアの響き 1〜5kHz / ハイハット・シンバル 7〜16kHz
    """
    y, _ = librosa.load(stem_path(song_id, "drums"), sr=SR, mono=True)
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=HOP)) ** 2
    freqs = librosa.fft_frequencies(sr=SR, n_fft=2048)
    n = S.shape[1]
    step = lambda sec: max(1, int(round(sec * SR / HOP)))
    win, pre = step(0.04), step(0.02)
    ranges = {"low": (30, 120), "lowmid": (120, 400), "mid": (1000, 5000), "high": (7000, 16000)}
    energy = {b: S[(freqs >= lo) & (freqs < hi)].sum(axis=0) for b, (lo, hi) in ranges.items()}

    def onsets(b, wait_sec):
        sub = librosa.power_to_db(S[(freqs >= ranges[b][0]) & (freqs < ranges[b][1])], ref=np.max)
        env = librosa.onset.onset_strength(S=sub, sr=SR, hop_length=HOP)
        env = env / (env.max() + 1e-9)
        return librosa.onset.onset_detect(onset_envelope=env, sr=SR, hop_length=HOP, delta=cfg["drumDelta"], wait=step(wait_sec))

    def rise(b, f):
        after = energy[b][f: min(n, f + win)].max()
        before = energy[b][max(0, f - pre): f].mean() if f > 0 else 0.0
        return max(0.0, after - before)

    def sustain(b, f, sec):
        peak = energy[b][f: min(n, f + win)].max() + 1e-12
        return energy[b][min(n - 1, f + step(sec))] / peak

    cand = {b: onsets(b, 0.06 if b in ("low", "lowmid") else 0.04) for b in ranges}
    # 帯域ごとの「強い音」の目安：その帯域で見つけた出始めの増え方の 95% 点
    ref = {b: np.percentile([rise(b, f) for f in cand[b]] or [1.0], 95) + 1e-12 for b in ranges}
    norm = lambda b, f: min(2.0, rise(b, f) / ref[b])

    hits = []
    kicks = [f for f in cand["low"] if norm("low", f) > 0.25]
    hits += [(f, KICK, norm("low", f)) for f in kicks]
    snares = [f for f in cand["mid"] if norm("mid", f) > 0.35 and norm("lowmid", f) > 0.15 and norm("mid", f) >= 0.6 * norm("high", f)]
    hits += [(f, SNARE, norm("mid", f)) for f in snares]
    near = lambda f, frames, d: any(abs(f - g) <= d for g in frames)
    for f in cand["high"]:
        h = norm("high", f)
        if h < 0.2 or (near(f, snares, 2) and h < norm("mid", f)):
            continue  # 弱すぎる・スネアの高い成分
        if h > 0.8 and norm("mid", f) > 0.4 and sustain("high", f, 0.25) > 0.35:
            hits.append((f, CRASH, h))
        elif sustain("high", f, 0.12) > 0.3:
            hits.append((f, HAT_OPEN, h))
        else:
            hits.append((f, HAT_CLOSED, h))
    for f in cand["lowmid"]:
        if norm("lowmid", f) > 0.5 and not near(f, kicks + snares, 3):
            band = (freqs >= 80) & (freqs < 400)
            spec = S[band, f: f + win].sum(axis=1)
            centroid = (freqs[band] * spec).sum() / (spec.sum() + 1e-12)
            hits.append((f, TOM_HIGH if centroid > 180 else TOM_LOW, norm("lowmid", f)))
    hits.sort()
    return [{"time": round(float(librosa.frames_to_time(f, sr=SR, hop_length=HOP)), 4), "note": note, "amp": round(float(min(1.0, a)), 3)}
            for f, note, a in hits]


def transcribe(cfg, force=False):
    song_id = cfg["id"]
    out_dir = song_dir(song_id) / "notes"
    out_dir.mkdir(exist_ok=True)
    params = {k: cfg[k] for k in ("onsetThreshold", "frameThreshold", "drumDelta")}
    result, levels = {}, {}
    for stem in PITCHED_STEMS + ["drums"]:
        path = out_dir / f"{stem}.json"
        cached = read_json(path)
        if not force and cached and cached.get("params") == params:
            result[stem], levels[stem] = cached["notes"], cached["db"]
            continue
        db = stem_db(song_id, stem)
        if db < SILENT_DB:
            notes = []
            print(f"[{song_id}] ③ {stem}: ほぼ無音（{db:.0f} dB）なので採譜しません")
        else:
            print(f"[{song_id}] ③ {stem} を採譜します（{db:.0f} dB）")
            notes = drum_hits(song_id, cfg) if stem == "drums" else pitched_notes(song_id, stem, cfg)
        write_json(path, {"params": params, "db": round(float(db), 1), "notes": notes})
        result[stem], levels[stem] = notes, round(float(db), 1)
    return result, levels
