import { BASE_MONSTERS, FUSION_MONSTERS } from "../cards/catalog";

export const ANNOUNCER_CLIPS = {
  "ember-imp": "/audio/announcer/ember-imp.mp3",
  "cinder-wall": "/audio/announcer/cinder-wall.mp3",
  "tide-serpent": "/audio/announcer/tide-serpent.mp3",
  "reef-guardian": "/audio/announcer/reef-guardian.mp3",
  "stone-bull": "/audio/announcer/stone-bull.mp3",
  "moss-tortoise": "/audio/announcer/moss-tortoise.mp3",
  "gale-hawk": "/audio/announcer/gale-hawk.mp3",
  "cloud-sprite": "/audio/announcer/cloud-sprite.mp3",
  "spark-lynx": "/audio/announcer/spark-lynx.mp3",
  "volt-bat": "/audio/announcer/volt-bat.mp3",
  "inferno-beast": "/audio/announcer/inferno-beast.mp3",
  "steam-beast": "/audio/announcer/steam-beast.mp3",
  "magma-beast": "/audio/announcer/magma-beast.mp3",
  "wildfire-beast": "/audio/announcer/wildfire-beast.mp3",
  "plasma-beast": "/audio/announcer/plasma-beast.mp3",
  "tsunami-beast": "/audio/announcer/tsunami-beast.mp3",
  "swamp-beast": "/audio/announcer/swamp-beast.mp3",
  "ice-beast": "/audio/announcer/ice-beast.mp3",
  "storm-beast": "/audio/announcer/storm-beast.mp3",
  "golem-beast": "/audio/announcer/golem-beast.mp3",
  "sandstorm-beast": "/audio/announcer/sandstorm-beast.mp3",
  "crystal-beast": "/audio/announcer/crystal-beast.mp3",
  "cyclone-beast": "/audio/announcer/cyclone-beast.mp3",
  "thunderbird-beast": "/audio/announcer/thunderbird-beast.mp3",
  "thunder-beast": "/audio/announcer/thunder-beast.mp3",
  "fusion-initiated": "/audio/announcer/fusion-initiated.mp3",
  "fusion-complete": "/audio/announcer/fusion-complete.mp3",
  "three-star-fusion": "/audio/announcer/three-star-fusion.mp3",
  "direct-attack": "/audio/announcer/direct-attack.mp3",
  "attack-blocked": "/audio/announcer/attack-blocked.mp3",
  counterspell: "/audio/announcer/counterspell.mp3",
  "a-beast-has-fallen": "/audio/announcer/a-beast-has-fallen.mp3",
  "final-blow": "/audio/announcer/final-blow.mp3",
  victory: "/audio/announcer/victory.mp3",
  defeat: "/audio/announcer/defeat.mp3",
  "you-have-won-at-the-game-of-beast-battler": "/audio/announcer/you-have-won-at-the-game-of-beast-battler.mp3",
  "beast-mode-thanks": "/audio/announcer/beast-mode-thanks.mp3",
  "banished-to-the-shadow-realm": "/audio/announcer/banished-to-the-shadow-realm.mp3",
  "your-deck-ran-dry": "/audio/announcer/your-deck-ran-dry.mp3",
  "opposing-deck-ran-dry": "/audio/announcer/opposing-deck-ran-dry.mp3",
  "your-life-counter-reached-zero": "/audio/announcer/your-life-counter-reached-zero.mp3",
  "opposing-life-counter-reached-zero": "/audio/announcer/opposing-life-counter-reached-zero.mp3",
  "opponent-forfeited-you-win": "/audio/announcer/opponent-forfeited-you-win.mp3",
} as const;

export type AnnouncerLine = keyof typeof ANNOUNCER_CLIPS;

const monsterLineByName = new Map<string, AnnouncerLine>(
  [...BASE_MONSTERS, ...FUSION_MONSTERS].map((monster) => [monster.name, monster.id]),
);

export function announcerLineForMonster(monsterName: string): AnnouncerLine | null {
  return monsterLineByName.get(monsterName) ?? null;
}

export function announcerClipSource(line: AnnouncerLine): string {
  return ANNOUNCER_CLIPS[line];
}
