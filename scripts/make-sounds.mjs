// Generates MeshTerm's default alert sounds (CR-003 §7): short, small 16-bit mono WAVs.
// Run once: `node scripts/make-sounds.mjs` (writes apps/web/public/sounds/*.wav).
import { writeFileSync } from "node:fs";

const RATE = 22_050;

/**
 * Tones in sequence: [frequency Hz, seconds, gain 0–1]; 0 Hz is silence.
 * @param {[number, number, number][]} tones
 * @returns {number[]}
 */
function render(tones) {
  /** @type {number[]} */
  const samples = [];
  for (const [freq, secs, gain] of tones) {
    const n = Math.round(secs * RATE);
    for (let i = 0; i < n; i++) {
      // A quick attack and a smooth release, so there are no clicks.
      const env = Math.min(1, i / (0.005 * RATE)) * Math.min(1, (n - i) / (0.04 * RATE));
      const t = i / RATE;
      const v =
        freq === 0
          ? 0
          : Math.sin(2 * Math.PI * freq * t) * 0.8 + Math.sin(4 * Math.PI * freq * t) * 0.2;
      samples.push(v * env * gain);
    }
  }
  return samples;
}

/** @param {number[]} samples */
function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) =>
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32_767), i * 2),
  );
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const out = new URL("../apps/web/public/sounds/", import.meta.url);
/** @type {Record<string, [number, number, number][]>} */
const sounds = {
  // A DM: a rising two-note chime.
  message: [
    [880, 0.11, 0.5],
    [0, 0.03, 0],
    [1318.5, 0.16, 0.5],
  ],
  // A mention: three quick bright beeps.
  mention: [
    [1568, 0.07, 0.45],
    [0, 0.04, 0],
    [1568, 0.07, 0.45],
    [0, 0.04, 0],
    [2093, 0.1, 0.45],
  ],
  // A channel set to "all": one soft low note.
  channel: [[659.3, 0.14, 0.35]],
};
for (const [name, tones] of Object.entries(sounds)) {
  writeFileSync(new URL(`${name}.wav`, out), wav(render(tones)));
}
