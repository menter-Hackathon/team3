// 【出力・共通】設計図 → 音の柔らかさの設定（リバーブ・パッド）。
// 楽譜（midiToScore → score.sound）・音（sound.js）・MIDI の CC（MIDI の編集）が同じ数字を使うように、ここ1か所で決める。
// うごてんは自由に変えてよい（たいがへの確認は不要）。変えると楽譜・音・MIDI の CC のどれにも効くので、変えたことは PR に書く。
// ここでは音を鳴らさない・ブラウザの機能を使わない（Node でも動く）。
//
// soundFromBlueprint(blueprint) → { reverbDecay, reverbWet, padAttack, padRelease, padFilterHz }（Tone.js でそのまま使える数字）
//   声がない（sources.voice が false）ときは、既定の息っぽさ 0.3 のときの値
import { normalizeBlueprint } from "../blueprint.js";
import { round } from "../util.js";

const DEFAULT_BREATHINESS = 0.3;

export function soundFromBlueprint(input) {
  const bp = normalizeBlueprint(input);
  const b = bp.sources.voice ? bp.breathiness : DEFAULT_BREATHINESS;
  return {
    reverbDecay: round(lerp(1.5, 6, b)), // 秒（Tone.Reverb の decay）
    reverbWet: round(lerp(0.15, 0.5, b)), // 0〜1（Tone.Reverb の wet）
    padAttack: round(lerp(0.1, 1.5, b)), // 秒
    padRelease: round(lerp(0.8, 3, b)), // 秒
    padFilterHz: Math.round(4000 * Math.pow(900 / 4000, b)), // ローパスの周波数（耳の感じ方に合わせて対数で補間）
  };
}

const lerp = (a, b, t) => a + (b - a) * t;
