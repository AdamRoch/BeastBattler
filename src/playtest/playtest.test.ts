import { describe, expect, it } from "vitest";

import { runAiTurn, type AiAction } from "../ai/opponent";
import {
  ARCHETYPES,
  BASE_MONSTERS,
  CARD_CATALOG,
  FUSION_MONSTERS,
  SPELLS,
  assembleDeck,
  deriveExtraDeck,
  type ArchetypeId,
  type BaseMonsterId,
  type DeckCard,
  type SpellId,
} from "../cards/catalog";
import {
  advancePhase,
  createMatch,
  getPlayer,
  keepHand,
  summonMonster,
  type BaseMonsterCard,
  type Element,
  type FusionMonsterCard,
  type GameCard,
  type LandPermanent,
  type MatchState,
  type MonsterPermanent,
  type PlayerId,
  type SpellCard,
} from "../rules/core";
import {
  assignBlockers,
  declareAttackers,
  resolveCombat,
  type BlockAssignment,
} from "../rules/combat";
import { fuseMonsters } from "../rules/fusion";
import { castCounterspell, castSpell, passResponse } from "../rules/spells";

describe("scripted full matches", () => {
  it.each([
    ["fire-water", "earth-lightning"],
    ["fire-air", "water-earth"],
    ["water-lightning", "air-lightning"],
    ["fire-earth", "water-air"],
  ] as const)(
    "terminates %s vs %s with legal, varied AI play",
    (playerOneArchetype, playerTwoArchetype) => {
      const report = simulateFullMatch(
        playerOneArchetype,
        playerTwoArchetype,
      );

      expect(report.state.result).not.toBeNull();
      expect(report.state.turnNumber).toBeLessThanOrEqual(35);
      expect(report.steps).toBeLessThan(300);
      expect(report.actions).toContain("play-land");
      expect(report.actions).toContain("summon");
      expect(report.actions).toContain("fuse");
      expect(report.actions).toContain("upgrade-fusion");
      expect(report.actions).toContain("cast-spell");
      expect(report.actions).toContain("attack");
      expect(report.playerDamage).toBeGreaterThan(0);
    },
  );

  it("runs a complete hotseat-style match by alternating both players", () => {
    const report = simulateFullMatch("fire-lightning", "water-air");

    expect(report.state.result).toMatchObject({ reason: "life" });
    expect(report.controllers).toContain("player-1");
    expect(report.controllers).toContain("player-2");
    expect(report.actions.filter((action) => action === "attack").length)
      .toBeGreaterThanOrEqual(2);
  });
});

describe("stall risk", () => {
  it("ends a turtle scenario because blocked attackers deal excess damage", () => {
    let state = combatState(
      fusionPermanent("magma-beast", "pressure-attacker"),
      basePermanent("cinder-wall", "turtle-1"),
    );
    const lifeTotals = [getPlayer(state, "player-2").life];

    for (let round = 1; round <= 5 && !state.result; round += 1) {
      state = preparePressureRound(state, round);
      const declaration = declareAttackers(state, "player-1", [
        "pressure-attacker",
      ]);
      const plan = assignBlockers(state, "player-2", declaration, [
        { attackerId: "pressure-attacker", blockerId: `turtle-${round}` },
      ]);
      state = resolveCombat(state, plan);
      lifeTotals.push(getPlayer(state, "player-2").life);
    }

    expect(lifeTotals).toEqual([10, 8, 6, 4, 2, 0]);
    expect(state.result).toEqual({
      winner: "player-1",
      loser: "player-2",
      reason: "life",
    });
  });
});

describe("29-card exercise matrix", () => {
  it("uses every named chart card in a legal rules-engine action", () => {
    const exercised = new Set<string>();

    for (const definition of BASE_MONSTERS) {
      let state = mainPhaseState(archetypeForElement(definition.element));
      const card: BaseMonsterCard = {
        ...definition,
        instanceId: `exercise:${definition.id}`,
      };
      state = withPlayer(state, "player-1", {
        hand: [card],
        lands: [readyLand(definition.element, `land:${definition.element}`)],
      });
      state = summonMonster(state, "player-1", card.instanceId);
      state = passResponse(state, "player-2");

      expect(getPlayer(state, "player-1").monsters[0]?.card.name)
        .toBe(definition.name);
      exercised.add(definition.id);
    }

    for (const definition of FUSION_MONSTERS) {
      const archetype = archetypeForFusion(definition.id);
      const [first, second] = fusionParents(definition.elements);
      let state = mainPhaseState(archetype);
      state = withPlayer(state, "player-1", {
        monsters: [first, second],
      });
      state = fuseMonsters(state, "player-1", [
        first.card.instanceId,
        second.card.instanceId,
      ]);
      state = passResponse(state, "player-2");

      expect(getPlayer(state, "player-1").monsters[0]?.card.name)
        .toBe(definition.name);
      exercised.add(definition.id);
    }

    for (const id of ["bolt", "destroy", "draw"] as const) {
      const result = exerciseSorcery(id);
      expect(result.stack).toEqual([]);
      exercised.add(id);
    }

    const countered = exerciseCounterspell();
    expect(countered.stack).toEqual([]);
    exercised.add("counterspell");

    expect([...exercised].sort()).toEqual(
      CARD_CATALOG.map((card) => card.id).sort(),
    );
    expect(exercised.size).toBe(29);
  });
});

interface MatchReport {
  readonly state: MatchState;
  readonly steps: number;
  readonly actions: readonly AiAction["kind"][];
  readonly controllers: readonly PlayerId[];
  readonly playerDamage: number;
}

function simulateFullMatch(
  playerOneArchetype: ArchetypeId,
  playerTwoArchetype: ArchetypeId,
): MatchReport {
  let state = createMatch({
    playerOneDeck: orderedDeck(playerOneArchetype),
    playerTwoDeck: orderedDeck(playerTwoArchetype),
    playerOneExtraDeck: deriveExtraDeck(playerOneArchetype),
    playerTwoExtraDeck: deriveExtraDeck(playerTwoArchetype),
  });
  state = keepHand(state, "player-1");
  state = keepHand(state, "player-2");

  const actions: AiAction["kind"][] = [];
  const controllers: PlayerId[] = [];
  let playerDamage = 0;
  let steps = 0;

  while (!state.result && steps < 300) {
    steps += 1;
    const controller = state.responsePlayer ?? state.activePlayer;
    controllers.push(controller);
    const result = runAiTurn(state, controller);
    state = result.state;
    actions.push(...result.actions.map((action) => action.kind));

    if (!result.attackDeclaration) {
      continue;
    }

    const defender = getPlayer(state, result.attackDeclaration.defendingPlayer);
    const blocks = defender.monsters
      .slice(0, result.attackDeclaration.attackerIds.length)
      .map((blocker, index): BlockAssignment => ({
        attackerId: result.attackDeclaration?.attackerIds[index] ?? "",
        blockerId: blocker.card.instanceId,
      }));
    const plan = assignBlockers(
      state,
      result.attackDeclaration.defendingPlayer,
      result.attackDeclaration,
      blocks,
    );
    const lifeBefore = defender.life;
    state = resolveCombat(state, plan);
    playerDamage += lifeBefore - getPlayer(state, plan.defendingPlayer).life;
  }

  return { state, steps, actions, controllers, playerDamage };
}

function orderedDeck(archetypeId: ArchetypeId): readonly GameCard[] {
  const deck = assembleDeck(archetypeId);
  const lands = deck.filter((card) => card.kind === "land");
  const monsters = deck.filter((card) => card.kind === "monster");
  const spells = deck.filter((card) => card.kind === "spell");
  return compact([
    lands[0], monsters[0], spells[0], lands[4],
    monsters[4], lands[1], monsters[1], spells[1],
    lands[5], monsters[5], lands[2], monsters[2],
    spells[2], lands[6], monsters[6], lands[3],
    monsters[3], spells[3], lands[7], monsters[7],
  ]);
}

function compact(cards: readonly (DeckCard | undefined)[]): readonly DeckCard[] {
  return cards.filter((card): card is DeckCard => Boolean(card));
}

function combatState(
  attacker: MonsterPermanent,
  blocker: MonsterPermanent,
): MatchState {
  let state = mainPhaseState("fire-earth");
  state = withPlayer(state, "player-1", { monsters: [attacker] });
  state = withPlayer(state, "player-2", { monsters: [blocker] });
  return advancePhase(state);
}

function preparePressureRound(state: MatchState, round: number): MatchState {
  return {
    ...state,
    activePlayer: "player-1",
    phase: "combat",
    turnNumber: round * 2 - 1,
    players: [
      {
        ...state.players[0],
        monsters: state.players[0].monsters.map((monster) => ({
          ...monster,
          damage: 0,
          summoningSick: false,
        })),
      },
      {
        ...state.players[1],
        monsters: [basePermanent("cinder-wall", `turtle-${round}`)],
      },
    ],
  };
}

function mainPhaseState(archetype: ArchetypeId): MatchState {
  const deck = orderedDeck(archetype);
  let state = createMatch({
    playerOneDeck: deck,
    playerTwoDeck: deck,
    playerOneExtraDeck: deriveExtraDeck(archetype),
    playerTwoExtraDeck: deriveExtraDeck(archetype),
  });
  state = keepHand(state, "player-1");
  state = keepHand(state, "player-2");
  return state;
}

function withPlayer(
  state: MatchState,
  playerId: PlayerId,
  updates: Partial<MatchState["players"][number]>,
): MatchState {
  const players: [MatchState["players"][0], MatchState["players"][1]] = [
    state.players[0],
    state.players[1],
  ];
  const index = playerId === "player-1" ? 0 : 1;
  players[index] = { ...players[index], ...updates };
  return { ...state, players };
}

function archetypeForElement(element: Element): ArchetypeId {
  const archetype = ARCHETYPES.find((candidate) =>
    candidate.elements.some((candidateElement) => candidateElement === element),
  );
  if (!archetype) {
    throw new Error(`No archetype contains ${element}`);
  }
  return archetype.id;
}

function archetypeForFusion(fusionId: string): ArchetypeId {
  const archetype = ARCHETYPES.find((candidate) =>
    deriveExtraDeck(candidate.id).some((card) => card.id === fusionId),
  );
  if (!archetype) {
    throw new Error(`No archetype contains fusion ${fusionId}`);
  }
  return archetype.id;
}

function fusionParents(
  elements: readonly [Element, Element],
): readonly [MonsterPermanent, MonsterPermanent] {
  const firstDefinition = baseDefinition(elements[0], 0);
  const sameElement = elements[0] === elements[1];
  const secondDefinition = baseDefinition(elements[1], sameElement ? 1 : 0);
  return [
    basePermanent(firstDefinition.id, `parent:${elements[0]}:1`),
    basePermanent(secondDefinition.id, `parent:${elements[1]}:2`),
  ];
}

function baseDefinition(element: Element, index: number) {
  const definitions = BASE_MONSTERS.filter((card) => card.element === element);
  const definition = definitions[index];
  if (!definition) {
    throw new Error(`Missing base monster ${index} for ${element}`);
  }
  return definition;
}

function basePermanent(
  id: BaseMonsterId,
  instanceId: string,
): MonsterPermanent {
  const definition = BASE_MONSTERS.find((card) => card.id === id);
  if (!definition) {
    throw new Error(`Missing base monster ${id}`);
  }
  return {
    card: { ...definition, instanceId },
    damage: 0,
    summonedOnTurn: 0,
    summoningSick: false,
  };
}

function fusionPermanent(
  id: string,
  instanceId: string,
): MonsterPermanent {
  const definition = FUSION_MONSTERS.find((card) => card.id === id);
  if (!definition) {
    throw new Error(`Missing fusion monster ${id}`);
  }
  const card: FusionMonsterCard = { ...definition, instanceId };
  return {
    card,
    damage: 0,
    summonedOnTurn: 0,
    summoningSick: false,
  };
}

function readyLand(element: Element, instanceId: string): LandPermanent {
  return {
    card: { kind: "land", element, name: `${element} land`, instanceId },
    ready: true,
  };
}

function exerciseSorcery(id: Exclude<SpellId, "counterspell">): MatchState {
  const spell = spellCard(id, `exercise:${id}`);
  let state = mainPhaseState("fire-water");
  state = withPlayer(state, "player-1", {
    hand: [spell],
    lands: [readyLand("fire", "spell-land")],
  });
  if (id === "destroy") {
    state = withPlayer(state, "player-2", {
      monsters: [basePermanent("reef-guardian", "destroy-target")],
    });
  }
  const target = id === "bolt"
    ? { kind: "player" as const, playerId: "player-2" as const }
    : id === "destroy"
      ? {
          kind: "monster" as const,
          playerId: "player-2" as const,
          monsterId: "destroy-target",
        }
      : null;
  state = castSpell(state, "player-1", spell.instanceId, target, "fire");
  return passResponse(state, "player-2");
}

function exerciseCounterspell(): MatchState {
  const draw = spellCard("draw", "counter-target");
  const counter = spellCard("counterspell", "exercise:counterspell");
  let state = mainPhaseState("fire-water");
  state = withPlayer(state, "player-1", {
    hand: [draw],
    lands: [readyLand("fire", "player-one-land")],
  });
  state = withPlayer(state, "player-2", {
    hand: [counter],
    lands: [readyLand("water", "player-two-land")],
  });
  state = castSpell(state, "player-1", draw.instanceId, null, "fire");
  state = castCounterspell(
    state,
    "player-2",
    counter.instanceId,
    state.stack[0]?.stackId ?? "missing",
    "water",
  );
  return passResponse(state, "player-1");
}

function spellCard(id: SpellId, instanceId: string): SpellCard {
  const definition = SPELLS.find((card) => card.id === id);
  if (!definition) {
    throw new Error(`Missing spell ${id}`);
  }
  return { ...definition, instanceId };
}
