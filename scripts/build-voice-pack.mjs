import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const lines = [
  ["ember-imp", 10.998, 12.284],
  ["cinder-wall", 20.797, 22.642],
  ["tide-serpent", 30.618, 32.396],
  ["reef-guardian", 39.680, 41.780],
  ["stone-bull", 49.935, 52.199],
  ["moss-tortoise", 60.191, 62.243],
  ["gale-hawk", 69.926, 71.455],
  ["cloud-sprite", 79.026, 80.754],
  ["spark-lynx", 88.615, 90.658],
  ["volt-bat", 97.532, 99.554],
  ["inferno-beast", 110.823, 113.932],
  ["steam-beast", 123.040, 125.690],
  ["magma-beast", 134.583, 137.373],
  ["wildfire-beast", 147.377, 150.369],
  ["plasma-beast", 158.493, 160.613],
  ["tsunami-beast", 169.029, 172.012],
  ["swamp-beast", 180.101, 182.200],
  ["ice-beast", 188.821, 191.058],
  ["storm-beast", 198.788, 200.973],
  ["golem-beast", 208.588, 211.156],
  ["sandstorm-beast", 219.675, 223.214],
  ["crystal-beast", 231.453, 234.631],
  ["cyclone-beast", 243.713, 246.186],
  ["thunderbird-beast", 255.552, 258.967],
  ["thunder-beast", 266.438, 269.354],
  ["fusion-initiated", 278.002, 280.828],
  ["fusion-complete", 287.483, 290.224],
  ["three-star-fusion", 298.693, 302.111],
  ["direct-attack", 309.614, 312.023],
  ["attack-blocked", 318.487, 320.754],
  ["counterspell", 327.139, 329.169],
  ["a-beast-has-fallen", 336.781, 339.718],
  ["final-blow", 346.802, 349.648],
  ["victory", 355.378, 356.560],
  ["defeat", 362.399, 363.443],
  ["you-have-won-at-the-game-of-beast-battler", 373.936, 376.526],
  ["beast-mode-thanks", 388.436, 392.782],
  ["banished-to-the-shadow-realm", 408.011, 414.510],
  ["your-deck-ran-dry", 421.365, 423.441],
  ["opposing-deck-ran-dry", 432.161, 434.938],
  ["your-life-counter-reached-zero", 443.520, 447.365],
  ["opposing-life-counter-reached-zero", 456.926, 462.111],
  ["opponent-forfeited-you-win", 471.017, 474.899],
];

const sourceArgument = process.argv.find((argument) => argument.startsWith("--source="));
const source = resolve(sourceArgument?.slice("--source=".length) ?? "voice-acting.m4a");
const output = resolve("public/audio/announcer");

if (!existsSync(source)) {
  console.error(`Missing source recording: ${source}`);
  console.error("Pass it with --source=/absolute/path/to/voice-acting.m4a");
  process.exit(1);
}

mkdirSync(output, { recursive: true });

const filter = [
  "volume=-15dB",
  "asetrate=48000*0.793701",
  "aresample=48000",
  "atempo=1.259921",
  "highpass=f=65",
  "lowpass=f=11000",
  "equalizer=f=135:t=q:w=1:g=3",
  "equalizer=f=340:t=q:w=1.3:g=-3",
  "equalizer=f=2400:t=q:w=1:g=2",
  "acompressor=threshold=0.06:ratio=4.5:attack=5:release=150:makeup=2.4:knee=4",
  "asoftclip=type=tanh:threshold=0.8:output=0.9:oversample=4",
  "aecho=0.8:0.18:90|185:0.13|0.055",
  "loudnorm=I=-16:TP=-2:LRA=6",
].join(",");

for (const [id, speechStart, speechEnd] of lines) {
  const start = Math.max(0, speechStart - 0.12);
  const duration = speechEnd - speechStart + 0.24;
  const target = resolve(output, `${id}.mp3`);
  const result = spawnSync("ffmpeg", [
    "-hide_banner",
    "-loglevel", "error",
    "-y",
    "-ss", start.toFixed(3),
    "-t", duration.toFixed(3),
    "-i", source,
    "-af", filter,
    "-ar", "48000",
    "-ac", "1",
    "-codec:a", "libmp3lame",
    "-b:a", "112k",
    target,
  ], { stdio: "inherit" });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  console.log(`Built ${id}.mp3`);
}

console.log(`Built ${lines.length} announcer clips in ${output}`);
