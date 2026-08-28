import { describe, expect, it } from "vitest";

import {
  BASE_MONSTERS,
  FUSION_MONSTERS,
  SPELLS,
  assembleDeck,
  deriveExtraDeck,
  type BaseMonsterId,
  type FusionMonsterId,
  type SpellId,
} from "../cards/catalog";
import {
  createMatch,
  getPlayer,
  keepHand,
  type BaseMonsterCard,
  type Element,
  type FusionMonsterCard,
  type GameCard,
  type LandCard,
  type LandPermanent,
  type MatchState,
  type MonsterPermanent,
  type PendingStackItem,
  type SpellCard,
} from "../rules/core";
import { passResponse } from "../rules/spells";
import { runAiTurn } from "./opponent";

const AI = "player-2";
const HUMAN = "player-1";

describe("scripted AI main phase", () => {
  it("plays the first available land and remains deterministic", () => {
    const land = landCard("fire", "ai-land");
    const initial = scriptedState({ aiHand: [land] });

    const firstRun = runAiTurn(initial, AI);
    const secondRun = runAiTurn(initial, AI);

    expect(firstRun).toEqual(secondRun);
    expect(initial).toEqual(scriptedState({ aiHand: [land] }));
    expect(firstRun.actions[0]).toEqual({
      kind: "play-land",
      cardId: land.instanceId,
    });
    expect(getPlayer(firstRun.state, AI).lands[0].card).toEqual(land);
    expect(firstRun.waitingFor).toBe("turn-complete");
  });

  it("prefers an affordable monster that completes an available fusion pair", () => {
    const fireInHand = baseCard("ember-imp", "fire-in-hand");
    const waterInHand = baseCard("tide-serpent", "water-in-hand");
    const steam = fusionCard("steam-beast", "steam-extra");
    const state = scriptedState({
      aiHand: [fireInHand, waterInHand],
      aiLands: [readyLand("fire", "fire-land"), readyLand("water", "water-land")],
      aiMonsters: [basePermanent("cinder-wall", "fire-parent")],
      aiExtraDeck: [steam],
    });

    const result = runAiTurn(state, AI);

    expect(result.actions).toEqual([
      { kind: "summon", cardId: waterInHand.instanceId },
    ]);
    expect(result.state.stack[0]).toMatchObject({
      kind: "summon",
      card: { instanceId: waterInHand.instanceId },
    });
    expect(result.waitingFor).toBe("opponent-response");
  });

  it("keeps summoning while cards, mana, and board space remain", () => {
    const first = baseCard("ember-imp", "first-summon");
    const second = baseCard("tide-serpent", "second-summon");
    let state = scriptedState({
      aiHand: [first, second],
      aiLands: [readyLand("fire", "fire-land"), readyLand("water", "water-land")],
      aiExtraDeck: [],
    });

    state = runAiTurn(state, AI).state;
    state = passResponse(state, HUMAN);
    const secondStep = runAiTurn(state, AI);

    expect(secondStep.actions).toEqual([
      { kind: "summon", cardId: second.instanceId },
    ]);
    expect(secondStep.state.stack[0]).toMatchObject({
      card: { instanceId: second.instanceId },
    });
  });

  it("always fuses a valid pair, then absorbs a matching base monster for level 3", () => {
    let state = scriptedState({
      aiMonsters: [
        basePermanent("ember-imp", "fire-parent"),
        basePermanent("tide-serpent", "water-parent"),
        basePermanent("reef-guardian", "absorb-target"),
      ],
    });

    const fusionStep = runAiTurn(state, AI);
    expect(fusionStep.actions).toEqual([
      {
        kind: "fuse",
        parentIds: ["fire-parent", "water-parent"],
      },
    ]);

    state = passResponse(fusionStep.state, HUMAN);
    const upgradeStep = runAiTurn(state, AI);
    const upgradedFusion = getPlayer(upgradeStep.state, AI).monsters.find(
      (monster) => monster.card.category === "fusion-monster",
    );

    expect(upgradeStep.actions[0]).toEqual({
      kind: "upgrade-fusion",
      fusionId: "fire-water:fusion:steam-beast:1",
      baseMonsterId: "absorb-target",
    });
    expect(upgradedFusion?.card).toMatchObject({ level: 3, attack: 4, health: 4 });
  });

  it("Bolts an enemy fusion before considering lethal face damage", () => {
    const bolt = spellCard("bolt", "ai-bolt");
    const enemyFusion = fusionPermanent("steam-beast", "enemy-fusion");
    const state = scriptedState({
      aiHand: [bolt],
      aiLands: [readyLand("fire", "fire-land")],
      humanLife: 2,
      humanMonsters: [enemyFusion],
    });

    const result = runAiTurn(state, AI);

    expect(result.actions).toEqual([
      {
        kind: "cast-spell",
        cardId: bolt.instanceId,
        spellId: "bolt",
        target: {
          kind: "monster",
          playerId: HUMAN,
          monsterId: enemyFusion.card.instanceId,
        },
        payWith: "fire",
      },
    ]);
  });

  it("Bolts face only when two damage is lethal", () => {
    const bolt = spellCard("bolt", "ai-bolt");
    const lethal = scriptedState({
      aiHand: [bolt],
      aiLands: [readyLand("water", "water-land")],
      humanLife: 2,
    });
    const nonlethal = scriptedState({
      aiHand: [bolt],
      aiLands: [readyLand("water", "water-land")],
      humanLife: 3,
    });

    expect(runAiTurn(lethal, AI).actions[0]).toMatchObject({
      kind: "cast-spell",
      spellId: "bolt",
      target: { kind: "player", playerId: HUMAN },
    });
    expect(
      runAiTurn(nonlethal, AI).actions.some(
        (action) => action.kind === "cast-spell",
      ),
    ).toBe(false);
  });

  it("uses Destroy on the highest-attack enemy monster", () => {
    const bolt = spellCard("bolt", "ai-bolt");
    const destroy = spellCard("destroy", "ai-destroy");
    const stronger = basePermanent("stone-bull", "stronger");
    const weaker = basePermanent("reef-guardian", "weaker");
    const state = scriptedState({
      aiHand: [bolt, destroy],
      aiLands: [readyLand("earth", "earth-land")],
      humanLife: 3,
      humanMonsters: [weaker, stronger],
    });

    expect(runAiTurn(state, AI).actions[0]).toMatchObject({
      kind: "cast-spell",
      spellId: "destroy",
      target: { kind: "monster", monsterId: stronger.card.instanceId },
    });
  });
});

describe("scripted AI combat", () => {
  it("attacks with every eligible monster only when blockers are outnumbered", () => {
    const attacker = basePermanent("ember-imp", "attacker");
    const slow = fusionPermanent("tsunami-beast", "slow-fusion");
    const sick = basePermanent("tide-serpent", "sick", true);
    const state = scriptedState({
      phase: "combat",
      aiMonsters: [attacker, slow, sick],
    });

    const result = runAiTurn(state, AI);

    expect(result.actions).toEqual([
      { kind: "attack", attackerIds: [attacker.card.instanceId] },
    ]);
    expect(result.attackDeclaration?.attackerIds).toEqual([
      attacker.card.instanceId,
    ]);
    expect(result.waitingFor).toBe("blockers");
  });

  it("holds when the opponent has at least as many blockers as attackers", () => {
    const state = scriptedState({
      phase: "combat",
      aiMonsters: [basePermanent("ember-imp", "attacker")],
      humanMonsters: [basePermanent("tide-serpent", "blocker")],
    });

    const result = runAiTurn(state, AI);

    expect(result.actions[0]).toEqual({ kind: "hold-attack" });
    expect(result.attackDeclaration).toBeNull();
    expect(result.waitingFor).toBe("turn-complete");
  });

  it("does not count ground creatures as blockers against Flying", () => {
    const state = scriptedState({
      phase: "combat",
      aiMonsters: [basePermanent("volt-bat", "flying-attacker")],
      humanMonsters: [basePermanent("ember-imp", "ground-blocker")],
    });

    expect(runAiTurn(state, AI).actions[0]).toEqual({
      kind: "attack",
      attackerIds: ["flying-attacker"],
    });
  });

  it("counts Reach as a legal blocker against Flying", () => {
    const state = scriptedState({
      phase: "combat",
      aiMonsters: [basePermanent("volt-bat", "flying-attacker")],
      humanMonsters: [basePermanent("cinder-wall", "reach-blocker")],
    });

    expect(runAiTurn(state, AI).actions[0]).toEqual({ kind: "hold-attack" });
  });

  it("pauses only an empty combat phase for controller presentation", () => {
    const state = scriptedState({
      phase: "combat",
      aiMonsters: [basePermanent("ember-imp", "sick", true)],
    });

    const result = runAiTurn(state, AI, { stopAtEmptyCombat: true });

    expect(result.actions).toEqual([]);
    expect(result.state.phase).toBe("combat");
    expect(result.waitingFor).toBe("empty-combat");
  });

  it("does not pause a strategic hold when a ready attacker exists", () => {
    const state = scriptedState({
      phase: "combat",
      aiMonsters: [basePermanent("ember-imp", "attacker")],
      humanMonsters: [basePermanent("tide-serpent", "blocker")],
    });

    const result = runAiTurn(state, AI, { stopAtEmptyCombat: true });

    expect(result.actions[0]).toEqual({ kind: "hold-attack" });
    expect(result.waitingFor).toBe("turn-complete");
  });
});

describe("scripted AI Counterspell policy", () => {
  it.each([
    ["fusion summon", pendingFusion()],
    ["Destroy", pendingSpell("destroy")],
  ] as const)("counters an opponent's %s with one unused land", (_label, pending) => {
    const counterspell = spellCard("counterspell", "ai-counterspell");
    const state = responseState(pending, {
      aiHand: [counterspell],
      aiLands: [readyLand("water", "water-land")],
    });

    const result = runAiTurn(state, AI);

    expect(result.actions).toEqual([
      {
        kind: "counterspell",
        cardId: counterspell.instanceId,
        targetStackId: pending.stackId,
        payWith: "water",
      },
    ]);
    expect(result.state.stack).toHaveLength(2);
    expect(result.waitingFor).toBe("opponent-response");
  });

  it("passes on other spells, base summons, and when no mana is open", () => {
    const counterspell = spellCard("counterspell", "ai-counterspell");
    const boltState = responseState(pendingSpell("bolt"), {
      aiHand: [counterspell],
      aiLands: [readyLand("fire", "ready-land")],
    });
    const summonState = responseState(pendingSummon(), {
      aiHand: [counterspell],
      aiLands: [readyLand("fire", "ready-land")],
    });
    const fusionWithoutMana = responseState(pendingFusion(), {
      aiHand: [counterspell],
      aiLands: [spentLand("fire", "spent-land")],
    });

    expect(runAiTurn(boltState, AI).actions[0]).toEqual({
      kind: "pass-response",
    });
    expect(runAiTurn(summonState, AI).actions[0]).toEqual({
      kind: "pass-response",
    });
    expect(runAiTurn(fusionWithoutMana, AI).actions[0]).toEqual({
      kind: "pass-response",
    });
  });
});

interface StateOptions {
  readonly phase?: MatchState["phase"];
  readonly aiHand?: readonly GameCard[];
  readonly aiLands?: readonly LandPermanent[];
  readonly aiMonsters?: readonly MonsterPermanent[];
  readonly aiExtraDeck?: readonly FusionMonsterCard[];
  readonly humanHand?: readonly GameCard[];
  readonly humanLands?: readonly LandPermanent[];
  readonly humanMonsters?: readonly MonsterPermanent[];
  readonly humanLife?: number;
}

function scriptedState(options: StateOptions = {}): MatchState {
  const deck = assembleDeck("fire-water");
  let state = createMatch({
    playerOneDeck: deck,
    playerTwoDeck: deck,
    playerOneExtraDeck: deriveExtraDeck("fire-water"),
    playerTwoExtraDeck: deriveExtraDeck("fire-water"),
    firstPlayer: AI,
  });
  state = keepHand(state, HUMAN);
  state = keepHand(state, AI);

  return {
    ...state,
    phase: options.phase ?? "main",
    players: [
      {
        ...state.players[0],
        life: options.humanLife ?? state.players[0].life,
        hand: options.humanHand ?? [],
        lands: options.humanLands ?? [],
        monsters: options.humanMonsters ?? [],
      },
      {
        ...state.players[1],
        hand: options.aiHand ?? [],
        lands: options.aiLands ?? [],
        monsters: options.aiMonsters ?? [],
        extraDeck: options.aiExtraDeck ?? state.players[1].extraDeck,
      },
    ],
  };
}

function responseState(
  pending: PendingStackItem,
  options: StateOptions,
): MatchState {
  const state = scriptedState(options);
  return {
    ...state,
    activePlayer: HUMAN,
    stack: [pending],
    responsePlayer: AI,
  };
}

function pendingFusion(): PendingStackItem {
  return {
    stackId: "human-fusion-stack",
    kind: "fusion",
    controller: HUMAN,
    card: fusionCard("steam-beast", "human-fusion"),
    parentNames: ["Ember Imp", "Tide Serpent"],
  };
}

function pendingSummon(): PendingStackItem {
  return {
    stackId: "human-summon-stack",
    kind: "summon",
    controller: HUMAN,
    card: baseCard("ember-imp", "human-summon"),
  };
}

function pendingSpell(id: "bolt" | "destroy"): PendingStackItem {
  const card = spellCard(id, `human-${id}`);
  return {
    stackId: `human-${id}-stack`,
    kind: "spell",
    controller: HUMAN,
    card,
    target:
      id === "bolt"
        ? { kind: "player", playerId: AI }
        : { kind: "monster", playerId: AI, monsterId: "target" },
    targetStackId: null,
  };
}

function baseCard(id: BaseMonsterId, instanceId: string): BaseMonsterCard {
  const definition = BASE_MONSTERS.find((card) => card.id === id);
  if (!definition) {
    throw new Error(`Missing base monster: ${id}`);
  }
  return { ...definition, instanceId };
}

function fusionCard(
  id: FusionMonsterId,
  instanceId: string,
): FusionMonsterCard {
  const definition = FUSION_MONSTERS.find((card) => card.id === id);
  if (!definition) {
    throw new Error(`Missing fusion monster: ${id}`);
  }
  return { ...definition, instanceId };
}

function spellCard(id: SpellId, instanceId: string): SpellCard {
  const definition = SPELLS.find((card) => card.id === id);
  if (!definition) {
    throw new Error(`Missing spell: ${id}`);
  }
  return { ...definition, instanceId };
}

function basePermanent(
  id: BaseMonsterId,
  instanceId: string,
  summoningSick = false,
): MonsterPermanent {
  return permanent(baseCard(id, instanceId), summoningSick);
}

function fusionPermanent(
  id: FusionMonsterId,
  instanceId: string,
): MonsterPermanent {
  return permanent(fusionCard(id, instanceId), false);
}

function permanent(
  card: BaseMonsterCard | FusionMonsterCard,
  summoningSick: boolean,
): MonsterPermanent {
  return {
    card,
    damage: 0,
    summonedOnTurn: summoningSick ? 1 : 0,
    summoningSick,
  };
}

function landCard(element: Element, instanceId: string): LandCard {
  return {
    instanceId,
    kind: "land",
    element,
    name: `${element} land`,
  };
}

function readyLand(element: Element, instanceId: string): LandPermanent {
  return { card: landCard(element, instanceId), ready: true };
}

function spentLand(element: Element, instanceId: string): LandPermanent {
  return { card: landCard(element, instanceId), ready: false };
}
