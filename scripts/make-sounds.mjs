// Generates MeshTerm's alert sounds: short, small 16-bit mono WAVs. The defaults
// (CR-003 §7) in apps/web/public/sounds/ and the built-in themes' sets (CR-004) in
// themes/<id>/sounds/. Run once: `node scripts/make-sounds.mjs`.
import { mkdirSync, writeFileSync } from "node:fs";

const RATE = 22_050;

/**
 * Tones in sequence: [frequency Hz, seconds, gain 0–1]; 0 Hz is silence. `square` is a
 * soft square wave (odd harmonics only), like an old terminal's beeper.
 * @param {[number, number, number][]} tones
 * @param {"sine" | "square"} [wave]
 * @returns {number[]}
 */
function render(tones, wave = "sine") {
  /** @type {number[]} */
  const samples = [];
  for (const [freq, secs, gain] of tones) {
    const n = Math.round(secs * RATE);
    for (let i = 0; i < n; i++) {
      // A quick attack and a smooth release, so there are no clicks.
      const env = Math.min(1, i / (0.005 * RATE)) * Math.min(1, (n - i) / (0.04 * RATE));
      const t = i / RATE;
      const w = 2 * Math.PI * freq * t;
      const v =
        freq === 0
          ? 0
          : wave === "square"
            ? (Math.sin(w) + Math.sin(3 * w) / 3 + Math.sin(5 * w) / 5) * 0.7
            : Math.sin(w) * 0.8 + Math.sin(2 * w) * 0.2;
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

/** @type {Record<string, [number, number, number][]>} */
const defaults = {
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
/** Retro Terminal (CR-004 Phase C): plain beeps. @type {Record<string, [number, number, number][]>} */
const retro = {
  // A DM: two short beeps.
  message: [
    [1000, 0.07, 0.35],
    [0, 0.05, 0],
    [1000, 0.07, 0.35],
  ],
  // A mention: a higher triple beep.
  mention: [
    [1500, 0.05, 0.35],
    [0, 0.04, 0],
    [1500, 0.05, 0.35],
    [0, 0.04, 0],
    [1500, 0.05, 0.35],
  ],
  // A channel message: one low blip.
  channel: [[600, 0.06, 0.3]],
};

/** @type {[string, Record<string, [number, number, number][]>, "sine" | "square"][]} */
const sets = [
  ["../apps/web/public/sounds/", defaults, "sine"],
  ["../themes/retro-terminal/sounds/", retro, "square"],
  ["../themes/retro-terminal-amber/sounds/", retro, "square"],
];
for (const [dir, sounds, wave] of sets) {
  const out = new URL(dir, import.meta.url);
  mkdirSync(out, { recursive: true });
  for (const [name, tones] of Object.entries(sounds)) {
    writeFileSync(new URL(`${name}.wav`, out), wav(render(tones, wave)));
  }
}
