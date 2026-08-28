import {
  ARCHETYPES,
  assembleDeck,
  deriveExtraDeck,
  type ArchetypeId,
  type BaseCreatureKeyword,
  type FusionKeyword,
} from "./catalog";

export interface DeckPreviewCreature {
  readonly name: string;
  readonly attack: number;
  readonly health: number;
  readonly keyword: BaseCreatureKeyword | null;
}

export interface DeckPreviewSpell {
  readonly name: string;
  readonly rulesText: string;
}

export interface DeckPreviewFusion {
  readonly name: string;
  readonly attack: number;
  readonly health: number;
  readonly keyword: FusionKeyword | null;
}

export interface DeckPreview {
  readonly id: ArchetypeId;
  readonly elementNames: readonly [string, string];
  readonly deckSize: number;
  readonly creatures: readonly DeckPreviewCreature[];
  readonly spells: readonly DeckPreviewSpell[];
  readonly fusions: readonly DeckPreviewFusion[];
  readonly roleSummary: string;
}

export function buildDeckPreview(archetypeId: ArchetypeId): DeckPreview {
  const archetype = ARCHETYPES.find((candidate) => candidate.id === archetypeId);
  if (!archetype) throw new Error(`Unknown archetype: ${archetypeId}`);

  const deck = assembleDeck(archetypeId);
  const creatures = deck
    .filter((card) => card.kind === "monster")
    .filter((card, index, cards) => cards.findIndex((candidate) => candidate.id === card.id) === index)
    .map(({ name, attack, health, keyword }) => ({ name, attack, health, keyword }));
  const spells = deck
    .filter((card) => card.kind === "spell")
    .map(({ name, rulesText }) => ({ name, rulesText }));
  const fusions = deriveExtraDeck(archetypeId)
    .map(({ name, attack, health, keyword }) => ({ name, attack, health, keyword }));

  return {
    id: archetypeId,
    elementNames: archetype.elements.map(elementName) as [string, string],
    deckSize: deck.length,
    creatures,
    spells,
    fusions,
    roleSummary: roleSummary(creatures),
  };
}

export function deckPreviewMarkup(preview: DeckPreview): string {
  const [first, second] = preview.elementNames;
  return `
    <span class="deck-preview" id="deck-preview-${preview.id}" role="tooltip">
      <span class="deck-preview-heading">
        <strong>${preview.deckSize} CARDS</strong>
        <small>${first} + ${second}</small>
      </span>
      <span class="deck-preview-role">${preview.roleSummary}</span>
      <span class="deck-preview-section">
        <b>BASE BEASTS</b>
        ${preview.creatures.map((creature) => `
          <span class="deck-preview-row">
            <span>${creature.name}${keywordLabel(creature.keyword)}</span>
            <em>${creature.attack}/${creature.health}</em>
          </span>
        `).join("")}
      </span>
      <span class="deck-preview-section">
        <b>SPELLS</b>
        ${preview.spells.map((spell) => `
          <span class="deck-preview-rule"><strong>${spell.name}:</strong> ${spell.rulesText}</span>
        `).join("")}
      </span>
      <span class="deck-preview-section">
        <b>FUSIONS</b>
        ${preview.fusions.map((fusion) => `
          <span class="deck-preview-row">
            <span>${fusion.name}${keywordLabel(fusion.keyword)}</span>
            <em>${fusion.attack}/${fusion.health}</em>
          </span>
        `).join("")}
      </span>
    </span>
  `;
}

function roleSummary(creatures: readonly DeckPreviewCreature[]): string {
  const flying = creatures.filter((creature) => creature.keyword === "flying").map((creature) => creature.name);
  const reach = creatures.filter((creature) => creature.keyword === "reach").map((creature) => creature.name);
  const roles: string[] = [];

  if (flying.length) roles.push(`Flying attackers: ${flying.join(", ")}.`);
  if (reach.length) roles.push(`Reach blockers: ${reach.join(", ")}.`);
  if (!flying.length) roles.push("No Flying attackers.");
  if (!reach.length) roles.push("Flying can only be blocked by your Flying beasts.");

  return roles.join(" ");
}

function keywordLabel(keyword: BaseCreatureKeyword | FusionKeyword | null): string {
  return keyword ? ` <i>${keyword.toUpperCase()}</i>` : "";
}

function elementName(element: string): string {
  return element.charAt(0).toUpperCase() + element.slice(1);
}
