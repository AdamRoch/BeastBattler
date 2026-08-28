import { describe, expect, it } from "vitest";

import {
  assembleDeck,
  deriveExtraDeck,
  type BaseMonsterCard,
  type FusionMonsterCard,
} from "../cards/catalog";
import type { CombatPlan } from "../rules/combat";
import {
  createMatch,
  type MatchResult,
  type MatchState,
  type MonsterPermanent,
  type PlayerId,
} from "../rules/core";
import { fuseMonsters, upgradeFusion } from "../rules/fusion";
import {
  combatAnnouncement,
  createAnnouncementDeduper,
  fallenBeastIds,
  fusionCompletionAnnouncement,
  resultAnnouncement,
} from "./announcer-events";

const plan = (blocks: number): CombatPlan => ({
  attackingPlayer: "player-1",
  defendingPlayer: "player-2",
  attackerIds: ["attacker"],
  turnNumber: 3,
  blocks: Array.from({ length: blocks }, (_, index) => ({
    attackerId: `attacker-${index}`,
    blockerId: `blocker-${index}`,
  })),
});

const result = (reason: MatchResult["reason"]): MatchResult => ({
  winner: "player-1",
  loser: "player-2",
  reason,
});

describe("announcer event selection", () => {
  it("uses the special three-star line instead of generic fusion completion", () => {
    expect(fusionCompletionAnnouncement(2)).toBe("fusion-complete");
    expect(fusionCompletionAnnouncement(3)).toBe("three-star-fusion");
  });

  it("gives final blow precedence over direct and blocked attack lines", () => {
    expect(combatAnnouncement(plan(0), null)).toBe("direct-attack");
    expect(combatAnnouncement(plan(1), null)).toBe("attack-blocked");
    expect(combatAnnouncement(plan(0), result("life"))).toBe("final-blow");
    expect(combatAnnouncement(plan(1), result("life"))).toBe("final-blow");
  });

  it.each([
    ["deck-out", "player-1", "opposing-deck-ran-dry"],
    ["deck-out", "player-2", "your-deck-ran-dry"],
    ["life", "player-1", "opposing-life-counter-reached-zero"],
    ["life", "player-2", "your-life-counter-reached-zero"],
  ] as const)("uses the local perspective for %s", (reason, viewer, line) => {
    expect(resultAnnouncement(result(reason), viewer as PlayerId)).toBe(line);
  });

  it("suppresses repeated announcements for a replayed event", () => {
    const deduper = createAnnouncementDeduper();
    expect(deduper.once("combat:3", "direct-attack")).toBe("direct-attack");
    expect(deduper.once("combat:3", "direct-attack")).toBeNull();
    expect(deduper.once("combat:4", "direct-attack")).toBe("direct-attack");
  });

  it("does not count normal fusion materials as fallen beasts", () => {
    const { state, ember, tide } = fusionFixture();

    const fused = fuseMonsters(
      state,
      "player-1",
      [ember.instanceId, tide.instanceId],
    );

    expect(fallenBeastIds(state, fused)).toEqual([]);
  });

  it("does not count a level-three fusion material as a fallen beast", () => {
    const { state, ember, steam } = fusionFixture();
    const upgradeState = withPlayerOneMonsters(state, [
      permanent(steam),
      permanent(ember),
    ]);

    const upgraded = upgradeFusion(
      upgradeState,
      "player-1",
      steam.instanceId,
      ember.instanceId,
    );

    expect(fallenBeastIds(upgradeState, upgraded)).toEqual([]);
  });

  it("still counts a destroyed beast as fallen", () => {
    const { state, ember } = fusionFixture();
    const before = withPlayerOneMonsters(state, [permanent(ember)]);
    const after: MatchState = {
      ...before,
      players: [
        {
          ...before.players[0],
          monsters: [],
          discardPile: [...before.players[0].discardPile, ember],
        },
        before.players[1],
      ],
    };

    expect(fallenBeastIds(before, after)).toEqual([ember.instanceId]);
  });
});

function fusionFixture(): {
  readonly state: MatchState;
  readonly ember: BaseMonsterCard;
  readonly tide: BaseMonsterCard;
  readonly steam: FusionMonsterCard;
} {
  const deck = assembleDeck("fire-water");
  const extraDeck = deriveExtraDeck("fire-water");
  const ember = deck.find(
    (card): card is BaseMonsterCard =>
      card.kind === "monster" &&
      card.category === "base-monster" &&
      card.id === "ember-imp",
  );
  const tide = deck.find(
    (card): card is BaseMonsterCard =>
      card.kind === "monster" &&
      card.category === "base-monster" &&
      card.id === "tide-serpent",
  );
  const steam = extraDeck.find((card) => card.name === "Steam Beast");
  if (!ember || !tide || !steam) {
    throw new Error("Missing fusion announcer fixtures");
  }

  const created = createMatch({
    playerOneDeck: deck,
    playerTwoDeck: deck,
    playerOneExtraDeck: extraDeck,
    playerTwoExtraDeck: extraDeck,
  });
  const state = withPlayerOneMonsters(
    {
      ...created,
      phase: "main",
      turnNumber: 2,
    },
    [permanent(ember), permanent(tide)],
  );
  return { state, ember, tide, steam };
}

function withPlayerOneMonsters(
  state: MatchState,
  monsters: readonly MonsterPermanent[],
): MatchState {
  return {
    ...state,
    players: [
      {
        ...state.players[0],
        monsters,
        mulliganDecision: "kept",
      },
      {
        ...state.players[1],
        mulliganDecision: "kept",
      },
    ],
  };
}

function permanent(
  card: BaseMonsterCard | FusionMonsterCard,
): MonsterPermanent {
  return {
    card,
    damage: 0,
    summonedOnTurn: 1,
    summoningSick: false,
  };
}
