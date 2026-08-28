import type {
  BaseMonsterCard as CoreBaseMonsterCard,
  BaseCreatureKeyword as CoreBaseCreatureKeyword,
  Element,
  FusionMonsterCard as CoreFusionMonsterCard,
  LandCard,
  SpellCard,
  SpellEffect as CoreSpellEffect,
} from "../rules/core";

export type BaseMonsterId =
  | "ember-imp"
  | "cinder-wall"
  | "tide-serpent"
  | "reef-guardian"
  | "stone-bull"
  | "moss-tortoise"
  | "gale-hawk"
  | "cloud-sprite"
  | "spark-lynx"
  | "volt-bat";

export type FusionMonsterId =
  | "inferno-beast"
  | "steam-beast"
  | "magma-beast"
  | "wildfire-beast"
  | "plasma-beast"
  | "tsunami-beast"
  | "swamp-beast"
  | "ice-beast"
  | "storm-beast"
  | "golem-beast"
  | "sandstorm-beast"
  | "crystal-beast"
  | "cyclone-beast"
  | "thunderbird-beast"
  | "thunder-beast";

export type SpellId = "bolt" | "destroy" | "draw" | "counterspell";
export type FusionKeyword = "burst" | "slow";
export type BaseCreatureKeyword = CoreBaseCreatureKeyword;

export interface BaseMonsterDefinition
  extends Omit<CoreBaseMonsterCard, "instanceId"> {
  readonly id: BaseMonsterId;
  readonly category: "base-monster";
  readonly level: 1;
  readonly cost: 1;
}

export interface FusionMonsterDefinition
  extends Omit<CoreFusionMonsterCard, "instanceId" | "level"> {
  readonly id: FusionMonsterId;
  readonly level: 2;
}

export type SpellEffect = CoreSpellEffect;

export interface SpellDefinition extends Omit<SpellCard, "instanceId"> {
  readonly id: SpellId;
  readonly category: "spell";
  readonly cost: 1;
  readonly timing: "sorcery" | "instant";
  readonly effect: SpellEffect;
  readonly rulesText: string;
}

export type CardDefinition =
  | BaseMonsterDefinition
  | FusionMonsterDefinition
  | SpellDefinition;

export type BaseMonsterCard = BaseMonsterDefinition & {
  readonly instanceId: string;
};

export type SpellCardInstance = SpellDefinition & {
  readonly instanceId: string;
};

export type FusionMonsterCard = FusionMonsterDefinition & {
  readonly instanceId: string;
};

export type DeckCard = LandCard | BaseMonsterCard | SpellCardInstance;

export const BASE_MONSTERS = [
  baseMonster("ember-imp", "Ember Imp", "fire", 2, 1),
  baseMonster("cinder-wall", "Cinder Wall", "fire", 1, 2, "reach"),
  baseMonster("tide-serpent", "Tide Serpent", "water", 1, 2),
  baseMonster("reef-guardian", "Reef Guardian", "water", 1, 3),
  baseMonster("stone-bull", "Stone Bull", "earth", 2, 2),
  baseMonster("moss-tortoise", "Moss Tortoise", "earth", 1, 3, "reach"),
  baseMonster("gale-hawk", "Gale Hawk", "air", 2, 1, "flying"),
  baseMonster("cloud-sprite", "Cloud Sprite", "air", 1, 2),
  baseMonster("spark-lynx", "Spark Lynx", "lightning", 2, 1),
  baseMonster("volt-bat", "Volt Bat", "lightning", 1, 2, "flying"),
] as const satisfies readonly BaseMonsterDefinition[];

export const FUSION_MONSTERS = [
  fusionMonster("inferno-beast", "Inferno Beast", ["fire", "fire"], 4, 2, "burst"),
  fusionMonster("steam-beast", "Steam Beast", ["fire", "water"], 3, 3),
  fusionMonster("magma-beast", "Magma Beast", ["fire", "earth"], 4, 3),
  fusionMonster("wildfire-beast", "Wildfire Beast", ["fire", "air"], 4, 2),
  fusionMonster("plasma-beast", "Plasma Beast", ["fire", "lightning"], 4, 2, "burst"),
  fusionMonster("tsunami-beast", "Tsunami Beast", ["water", "water"], 2, 5, "slow"),
  fusionMonster("swamp-beast", "Swamp Beast", ["water", "earth"], 2, 4),
  fusionMonster("ice-beast", "Ice Beast", ["water", "air"], 3, 4),
  fusionMonster("storm-beast", "Storm Beast", ["water", "lightning"], 3, 4),
  fusionMonster("golem-beast", "Golem Beast", ["earth", "earth"], 3, 5, "slow"),
  fusionMonster("sandstorm-beast", "Sandstorm Beast", ["earth", "air"], 3, 4),
  fusionMonster("crystal-beast", "Crystal Beast", ["earth", "lightning"], 3, 4),
  fusionMonster("cyclone-beast", "Cyclone Beast", ["air", "air"], 4, 3),
  fusionMonster("thunderbird-beast", "Thunderbird Beast", ["air", "lightning"], 4, 3),
  fusionMonster("thunder-beast", "Thunder Beast", ["lightning", "lightning"], 4, 3),
] as const satisfies readonly FusionMonsterDefinition[];

export const SPELLS = [
  {
    id: "bolt",
    category: "spell",
    kind: "spell",
    name: "Bolt",
    cost: 1,
    timing: "sorcery",
    effect: { kind: "damage", amount: 2, target: "any" },
    rulesText: "Deal 2 damage to any monster or player.",
  },
  {
    id: "destroy",
    category: "spell",
    kind: "spell",
    name: "Destroy",
    cost: 1,
    timing: "sorcery",
    effect: { kind: "destroy", target: "monster" },
    rulesText: "Destroy any creature regardless of its health.",
  },
  {
    id: "draw",
    category: "spell",
    kind: "spell",
    name: "Draw",
    cost: 1,
    timing: "sorcery",
    effect: { kind: "draw", count: 2 },
    rulesText: "Draw 2 cards.",
  },
  {
    id: "counterspell",
    category: "spell",
    kind: "spell",
    name: "Counterspell",
    cost: 1,
    timing: "instant",
    effect: { kind: "counter", target: "monster-summon-or-spell" },
    rulesText: "Counter a monster summon or spell.",
  },
] as const satisfies readonly SpellDefinition[];

export const CARD_CATALOG: readonly CardDefinition[] = [
  ...BASE_MONSTERS,
  ...FUSION_MONSTERS,
  ...SPELLS,
];

export function findSpellDefinition(spellId: string): SpellDefinition | undefined {
  return SPELLS.find((spell) => spell.id === spellId);
}

export const ARCHETYPES = [
  { id: "fire-water", elements: ["fire", "water"] },
  { id: "fire-earth", elements: ["fire", "earth"] },
  { id: "fire-air", elements: ["fire", "air"] },
  { id: "fire-lightning", elements: ["fire", "lightning"] },
  { id: "water-earth", elements: ["water", "earth"] },
  { id: "water-air", elements: ["water", "air"] },
  { id: "water-lightning", elements: ["water", "lightning"] },
  { id: "earth-air", elements: ["earth", "air"] },
  { id: "earth-lightning", elements: ["earth", "lightning"] },
  { id: "air-lightning", elements: ["air", "lightning"] },
] as const satisfies readonly {
  readonly id: string;
  readonly elements: readonly [Element, Element];
}[];

export type Archetype = (typeof ARCHETYPES)[number];
export type ArchetypeId = Archetype["id"];

const ELEMENT_NAMES: Readonly<Record<Element, string>> = {
  fire: "Fire",
  water: "Water",
  earth: "Earth",
  air: "Air",
  lightning: "Lightning",
};

export function assembleDeck(archetypeId: ArchetypeId): readonly DeckCard[] {
  const archetype = getArchetype(archetypeId);
  const lands = archetype.elements.flatMap((element) =>
    Array.from({ length: 4 }, (_, copyIndex): LandCard => ({
      instanceId: `${archetype.id}:land:${element}:${copyIndex + 1}`,
      kind: "land",
      element,
      name: `${ELEMENT_NAMES[element]} Land`,
    })),
  );
  const monsters = BASE_MONSTERS.filter((monster) =>
    archetype.elements.some((element) => element === monster.element),
  ).flatMap((monster) =>
    Array.from({ length: 2 }, (_, copyIndex): BaseMonsterCard => ({
      ...monster,
      instanceId: `${archetype.id}:monster:${monster.id}:${copyIndex + 1}`,
    })),
  );
  const spells = SPELLS.map(
    (spell): SpellCardInstance => ({
      ...spell,
      instanceId: `${archetype.id}:spell:${spell.id}:1`,
    }),
  );

  return [...lands, ...monsters, ...spells];
}

export function deriveExtraDeck(
  archetypeId: ArchetypeId,
): readonly FusionMonsterCard[] {
  const { elements } = getArchetype(archetypeId);
  const [first, second] = elements;

  return [
    findFusionMonster(first, first),
    findFusionMonster(first, second),
    findFusionMonster(second, second),
  ].map((fusion): FusionMonsterCard => ({
    ...fusion,
    instanceId: `${archetypeId}:fusion:${fusion.id}:1`,
  }));
}

function baseMonster(
  id: BaseMonsterId,
  name: string,
  element: Element,
  attack: number,
  health: number,
  keyword: BaseCreatureKeyword | null = null,
): BaseMonsterDefinition {
  return {
    id,
    category: "base-monster",
    kind: "monster",
    name,
    element,
    attack,
    health,
    level: 1,
    cost: 1,
    keyword,
  };
}

function fusionMonster(
  id: FusionMonsterId,
  name: string,
  elements: readonly [Element, Element],
  attack: number,
  health: number,
  keyword: FusionKeyword | null = null,
): FusionMonsterDefinition {
  return {
    id,
    category: "fusion-monster",
    kind: "monster",
    name,
    elements,
    attack,
    health,
    level: 2,
    keyword,
  };
}

function getArchetype(archetypeId: ArchetypeId): Archetype {
  const archetype = ARCHETYPES.find((candidate) => candidate.id === archetypeId);

  if (!archetype) {
    throw new Error(`Unknown archetype: ${archetypeId}`);
  }

  return archetype;
}

function findFusionMonster(
  first: Element,
  second: Element,
): FusionMonsterDefinition {
  const fusion = FUSION_MONSTERS.find(
    (candidate) =>
      candidate.elements[0] === first && candidate.elements[1] === second,
  );

  if (!fusion) {
    throw new Error(`No fusion exists for ${first} + ${second}`);
  }

  return fusion;
}
