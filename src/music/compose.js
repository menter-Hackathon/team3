// 【出力（原曲の選択・MIDI の編集＝うごてん、楽譜＝たいが）】設計図 → 原曲4曲から1曲を選ぶ → MIDI を編集（editMidiByBlueprint）→ 楽譜（midiToScore）。ここではまだ音を鳴らさない。
// 受け渡しの形は docs/interfaces.md の「5. 設計図」「6. 原曲」「7. 楽譜」。原曲の MIDI を読むので async（Promise<Score> を返す）。
//
// 書くもの:
//   compose(blueprint) → Score = {
//     bpm, duration: 秒（余韻込み）, timbre,
//     structure: [{ name: "intro" | "q1"…"q10" | "outro", start: 秒, end: 秒 }],
//     tracks: { voice, pad, bass, melody, kick, snare, hat },
//   }
//   音の形: voice  { time, duration?, detune? }
//           pad    { time, notes: ["D4", "F4", "A4"], duration, velocity }
//           bass / melody { time, note: "D2", duration, velocity }
//           kick / snare / hat { time, velocity }
//   各トラックは time の小さい順。同じトラックで同じ time を2回使わない。time は秒
//
// 決まっていること:
//   構成はイントロ2小節（声）→ 1問＝2小節 × 10 → アウトロ2小節（声）
//   同じ設計図からは同じ曲にする（Math.random ではなく、設計図から種を作った乱数を使う）
//
// 参考:
//   const bp = normalizeBlueprint(blueprint);
//   const beat = 60 / bp.bpm;              // 1拍の秒数。1小節は beat * 4
//   音階: SCALES[bp.scale] は主音から何半音上かの並び。主音は NOTES.indexOf(bp.root)
//   ノリ: 拍の時刻に bp.groove[4拍のうち何拍目か] を足すと、その人の叩き方のズレが出る
//   盛り上がり: bp.sections[i].energy で音数やドラムを増やす、brightness で音域を上げる、など
//   声: bp.sources.voice が true ならイントロ・アウトロに voice の音を置く
//   入力ができる前は、SAMPLE_BLUEPRINT（src/blueprint.js）で試せる
import { normalizeBlueprint } from "../blueprint.js";

export async function compose(blueprint) {
  const bp = normalizeBlueprint(blueprint);
  // TODO(出力・たいが)
  return {
    bpm: bp.bpm,
    duration: 0,
    timbre: bp.timbre,
    structure: [],
    tracks: { voice: [], pad: [], bass: [], melody: [], kick: [], snare: [], hat: [] },
  };
}
