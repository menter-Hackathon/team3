"""② 解析：拍の時刻・小節の頭・キー。

結果は work/<id>/analysis.json。songs.json の bpm / downbeatSec / key を書けば、推定より優先する。
  beats        拍の時刻（秒）の列。beats[0] が 0小節目の頭（負のこともある）。4つごとに小節の頭
  bpm          拍の間隔の中央値から出したテンポ（MIDI に書くテンポ。プロダクトでは設計図の bpm に合わせ直す）
  bars         曲全体の小節の数
  key          {"root": "D", "scale": "dorian"}（scale は src/blueprint.js の SCALES の名前）
"""
import math

import librosa
import numpy as np

from common import NOTES, PITCHED_STEMS, SCALES, STEMS, song_dir, stem_path, write_json

SR = 22050
HOP = 512  # 和音・キーを見るとき
FINE_HOP = 128  # 拍・音の出始めを見るとき（約 6ms）


def load_stems(song_id):
    return {s: librosa.load(stem_path(song_id, s), sr=SR, mono=True)[0] for s in STEMS}


def band_flux(y, lo, hi, n_fft=2048):
    """lo〜hi Hz の帯域だけの「音の出始めの強さ」（フレームごと。大きくなったぶんだけを足す）。"""
    S = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=HOP))
    freqs = librosa.fft_frequencies(sr=SR, n_fft=n_fft)
    band = librosa.amplitude_to_db(S[(freqs >= lo) & (freqs < hi)], ref=np.max)
    flux = np.maximum(0, np.diff(band, axis=1, prepend=band[:, :1])).mean(axis=0)
    return flux


def at_times(env, times):
    """フレームごとの値を、各時刻の前後 50ms の最大値で取り出す。"""
    frames = librosa.time_to_frames(np.maximum(times, 0), sr=SR, hop_length=HOP)
    w = max(1, int(0.05 * SR / HOP))
    return np.array([env[max(0, f - w): f + w + 1].max() if f < len(env) else 0.0 for f in frames])


def estimate_beats(mix, bpm_hint=None):
    """拍の時刻の列（テンポの揺れをそのまま残す）。

    AI で作った曲はテンポが揺れるので、一定の BPM の格子には合わない（数百 ms ずれる）。
    librosa の拍をそのまま使い、MIDI にするときに拍と拍の間で位置を数える（build_midi.py）。
    なめらかにしたり、ドラムで位相を合わせたりする方法も試したが、4曲とも元の拍のほうが音とよく合った。
    検出する側の遅れ（パートごとに一定）は build_midi.py でパートごとに補正する。
    """
    env = librosa.onset.onset_strength(y=mix, sr=SR, hop_length=FINE_HOP)
    kwargs = {"start_bpm": float(bpm_hint), "tightness": 400} if bpm_hint else {}
    _, beats = librosa.beat.beat_track(onset_envelope=env, sr=SR, hop_length=FINE_HOP, units="time", **kwargs)
    return beats


def extend_beats(beats, until_before, until_after):
    """拍の列を、端の拍の間隔で前後に伸ばす（曲の頭・終わりの拍が取れていないときのため）。"""
    head = np.median(np.diff(beats[:9]))
    tail = np.median(np.diff(beats[-9:]))
    before = []
    t = beats[0] - head
    while t > until_before:
        before.insert(0, t)
        t -= head
    after = []
    t = beats[-1] + tail
    while t < until_after:
        after.append(t)
        t += tail
    return np.concatenate([before, beats, after])


def estimate_downbeat(stems, beats):
    """4拍のうちどれが小節の頭か（0〜3）。キック・ベースの出始め・和音の変わり目が多い拍を頭にする。"""
    kick = at_times(band_flux(stems["drums"], 30, 150), beats)
    snare = at_times(band_flux(stems["drums"], 1500, 5000), beats)
    bass = at_times(band_flux(stems["bass"], 30, 300), beats)
    harm = sum(stems[s] for s in PITCHED_STEMS if s != "vocals")
    chroma = librosa.feature.chroma_cqt(y=harm, sr=SR, hop_length=HOP)
    frames = librosa.time_to_frames(np.maximum(beats, 0), sr=SR, hop_length=HOP).clip(0, chroma.shape[1] - 1)
    sync = np.stack([np.median(chroma[:, a:max(a + 1, b)], axis=1) for a, b in zip(frames, np.append(frames[1:], chroma.shape[1]))], axis=1)
    norm = sync / (np.linalg.norm(sync, axis=0, keepdims=True) + 1e-9)
    change = np.concatenate([[0], 1 - (norm[:, 1:] * norm[:, :-1]).sum(axis=0)])

    def nz(x):
        return x / (x.mean() + 1e-9)

    kick, snare, bass, change = nz(kick), nz(snare), nz(bass), nz(change)
    scores = []
    for p in range(4):
        q = (p + 2) % 4
        scores.append(kick[p::4].mean() + 0.5 * kick[q::4].mean() - 0.5 * snare[p::4].mean()
                      + bass[p::4].mean() + change[p::4].mean())
    return int(np.argmax(scores)), [round(float(x), 3) for x in scores]


def first_sound_sec(mix):
    rms = librosa.feature.rms(y=mix, hop_length=HOP)[0]
    loud = np.nonzero(rms > rms.max() * 0.05)[0]
    return float(librosa.frames_to_time(loud[0], sr=SR, hop_length=HOP)) if len(loud) else 0.0


# 各音階の重み：主音 > 5度 > 3度 > ほかの音階の音。音階にない音は 0
DEGREE_WEIGHTS = [2.0, 1.0, 1.2, 1.0, 1.5, 1.0, 1.0]
# 同じ構成音の音階どうし（F ionian と A# lydian など）では、よく使われる音階を少し優先する
SCALE_PRIOR = {"ionian": 0.06, "aeolian": 0.06, "dorian": 0.02, "mixolydian": 0.02, "phrygian": 0.0, "lydian": 0.0}


def estimate_key(stems):
    harm = sum(stems[s] for s in PITCHED_STEMS)
    chroma = librosa.feature.chroma_cqt(y=harm, sr=SR, hop_length=HOP).mean(axis=1)
    bass = librosa.feature.chroma_cqt(y=stems["bass"], sr=SR, hop_length=HOP).mean(axis=1)
    candidates = []
    for scale, steps in SCALES.items():
        for root in range(12):
            w = np.zeros(12)
            t = np.zeros(12)
            for deg, semi in enumerate(steps):
                w[(root + semi) % 12] = DEGREE_WEIGHTS[deg]
                t[(root + semi) % 12] = 3.0 if deg == 0 else 1.5 if deg == 4 else 0.5
            score = np.corrcoef(w, chroma)[0, 1] + 0.6 * np.corrcoef(t, bass)[0, 1] + SCALE_PRIOR[scale]
            candidates.append((float(score), NOTES[root], scale))
    candidates.sort(reverse=True)
    return candidates[:3]


def parse_key(text):
    root, scale = text.split()
    if root not in NOTES or scale not in SCALES:
        raise SystemExit(f"key の形が違います: {text!r}（例: \"D dorian\"。主音はシャープ、音階は {', '.join(SCALES)}）")
    return {"root": root, "scale": scale}


def analyze(cfg):
    song_id = cfg["id"]
    print(f"[{song_id}] ② 拍・小節の頭・キーを解析します")
    stems = load_stems(song_id)
    mix = sum(stems.values())
    duration = len(mix) / SR
    first = first_sound_sec(mix)
    beats = estimate_beats(mix, cfg.get("bpm"))
    # 最初の音より 1小節以上前から、曲の終わりより 1小節以上あとまで拍を伸ばす
    beat_sec = float(np.median(np.diff(beats)))
    beats = extend_beats(beats, first - 5 * beat_sec, duration + 5 * beat_sec)
    if cfg.get("downbeatSec") is not None:
        phase = int(np.argmin(np.abs(beats - float(cfg["downbeatSec"])))) % 4
        phase_scores = None
    else:
        phase, phase_scores = estimate_downbeat(stems, beats)
    # 0小節目の頭＝最初の音より前（か同じ）で、一番遅い小節の頭
    starts = [i for i in range(phase, len(beats), 4) if beats[i] <= first + 0.05]
    beats = beats[starts[-1] if starts else phase:]
    bars = math.ceil(np.searchsorted(beats, duration) / 4)
    beats = beats[: bars * 4 + 1]
    bpm = 60.0 / float(np.median(np.diff(beats)))
    key_candidates = estimate_key(stems)
    key = parse_key(cfg["key"]) if cfg.get("key") else {"root": key_candidates[0][1], "scale": key_candidates[0][2]}
    ioi_bpm = 60.0 / np.diff(beats)
    result = {
        "bpm": round(bpm, 2),
        "bpmRange": [round(float(np.percentile(ioi_bpm, 5)), 1), round(float(np.percentile(ioi_bpm, 95)), 1)],
        "bars": bars,
        "durationSec": duration,
        "key": key,
        "keyCandidates": [f"{r} {s} ({sc:.2f})" for sc, r, s in key_candidates],
        "downbeatPhaseScores": phase_scores,
        "overrides": {k: cfg.get(k) for k in ("bpm", "downbeatSec", "key") if cfg.get(k) is not None},
        "beats": [round(float(b), 4) for b in beats],
    }
    write_json(song_dir(song_id) / "analysis.json", result)
    print(f"[{song_id}]    BPM {result['bpm']}（揺れ {result['bpmRange'][0]}〜{result['bpmRange'][1]}）・"
          f"0小節目 {beats[0]:.3f} 秒・{bars} 小節・キー {key['root']} {key['scale']}（候補: {' / '.join(result['keyCandidates'])}）")
    return result
