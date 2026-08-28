import {
  advancePhase,
  discardToHandLimit,
  getPlayer,
  hasSummoningSickness,
  opponentOf,
  playLand,
  summonMonster,
  type BaseMonsterCard,
  type Element,
  type MatchState,
  type MonsterPermanent,
  type PendingStackItem,
  type PlayerId,
  type SpellCard,
  type SpellTarget,
} from "../rules/core";
import {
  countLegalBlockers,
  declareAttackers,
  type AttackDeclaration,
} from "../rules/combat";
import {
  findFusionOptions,
  fuseMonsters,
  upgradeFusion,
} from "../rules/fusion";
import {
  castCounterspell,
  castSpell,
  passResponse,
} from "../rules/spells";

export type AiAction =
  | Readonly<{ kind: "play-land"; cardId: string }>
  | Readonly<{ kind: "summon"; cardId: string }>
  | Readonly<{
      kind: "fuse";
      parentIds: readonly [string, string];
    }>
  | Readonly<{
      kind: "upgrade-fusion";
      fusionId: string;
      baseMonsterId: string;
    }>
  | Readonly<{
      kind: "cast-spell";
      cardId: string;
      spellId: "bolt" | "destroy";
      target: SpellTarget;
      payWith: Element;
    }>
  | Readonly<{
      kind: "counterspell";
      cardId: string;
      targetStackId: string;
      payWith: Element;
    }>
  | Readonly<{ kind: "pass-response" }>
  | Readonly<{ kind: "attack"; attackerIds: readonly string[] }>
  | Readonly<{ kind: "hold-attack" }>
  | Readonly<{ kind: "discard"; cardIds: readonly string[] }>
  | Readonly<{ kind: "advance-phase" }>;

type AiMainPhaseAction = Extract<
  AiAction,
  {
    kind:
      | "play-land"
      | "summon"
      | "fuse"
      | "upgrade-fusion"
      | "cast-spell"
      | "advance-phase";
  }
>;

export type AiWaitReason =
  | "opponent-response"
  | "blockers"
  | "empty-combat"
  | "turn-complete"
  | "not-ai-turn"
  | "match-complete";

export interface AiTurnResult {
  readonly state: MatchState;
  readonly actions: readonly AiAction[];
  readonly attackDeclaration: AttackDeclaration | null;
  readonly waitingFor: AiWaitReason;
}

export interface AiTurnOptions {
  readonly stopAtEmptyCombat?: boolean;
}

/**
 * Advances the AI until another player must make a decision or the turn ends.
 * The function has no randomness or hidden mutable state, so equal states
 * always produce equal results.
 */
export function runAiTurn(
  initialState: MatchState,
  aiPlayer: PlayerId,
  options: AiTurnOptions = {},
): AiTurnResult {
  let state = initialState;
  const actions: AiAction[] = [];

  while (true) {
    if (state.result) {
      return result(state, actions, "match-complete");
    }

    if (state.responsePlayer) {
      if (state.responsePlayer !== aiPlayer) {
        return result(state, actions, "opponent-response");
      }

      const response = chooseResponse(state, aiPlayer);
      actions.push(response);
      state = applyResponse(state, aiPlayer, response);

      if (state.responsePlayer && state.responsePlayer !== aiPlayer) {
        return result(state, actions, "opponent-response");
      }
      continue;
    }

    if (state.activePlayer !== aiPlayer) {
      return result(state, actions, "not-ai-turn");
    }

    switch (state.phase) {
      case "mulligan":
        return result(state, actions, "not-ai-turn");
      case "main": {
        const action = chooseMainPhaseAction(state, aiPlayer);
        actions.push(action);
        state = applyMainPhaseAction(state, aiPlayer, action);

        if (state.responsePlayer && state.responsePlayer !== aiPlayer) {
          return result(state, actions, "opponent-response");
        }
        continue;
      }
      case "combat": {
        const attackers = chooseAttackers(state, aiPlayer);
        if (attackers.length > 0) {
          const action: AiAction = { kind: "attack", attackerIds: attackers };
          actions.push(action);
          return {
            state,
            actions,
            attackDeclaration: declareAttackers(state, aiPlayer, attackers),
            waitingFor: "blockers",
          };
        }

        const hasReadyAttackers = getPlayer(state, aiPlayer).monsters.some(
          (monster) => !hasSummoningSickness(state, monster),
        );
        if (options.stopAtEmptyCombat && !hasReadyAttackers) {
          return result(state, actions, "empty-combat");
        }

        actions.push({ kind: "hold-attack" });
        state = advancePhase(state);
        continue;
      }
      case "end": {
        const player = getPlayer(state, aiPlayer);
        const discardCount = Math.max(0, player.hand.length - 7);
        if (discardCount > 0) {
          const cardIds = player.hand
            .slice(0, discardCount)
            .map((card) => card.instanceId);
          actions.push({ kind: "discard", cardIds });
          state = discardToHandLimit(state, aiPlayer, cardIds);
          continue;
        }

        actions.push({ kind: "advance-phase" });
        state = advancePhase(state);
        return result(state, actions, "turn-complete");
      }
    }
  }
}

function chooseMainPhaseAction(
  state: MatchState,
  aiPlayer: PlayerId,
): AiMainPhaseAction {
  const player = getPlayer(state, aiPlayer);

  if (!player.landPlayedThisTurn) {
    const land = player.hand.find((card) => card.kind === "land");
    if (land) {
      return { kind: "play-land", cardId: land.instanceId };
    }
  }

  const summon = chooseSummon(state, aiPlayer);
  if (summon) {
    return { kind: "summon", cardId: summon.instanceId };
  }

  const fusion = findFusionOptions(state, aiPlayer)[0];
  if (fusion) {
    return { kind: "fuse", parentIds: fusion.parentIds };
  }

  const upgrade = chooseFusionUpgrade(state, aiPlayer);
  if (upgrade) {
    return {
      kind: "upgrade-fusion",
      fusionId: upgrade.fusionId,
      baseMonsterId: upgrade.baseMonsterId,
    };
  }

  const spell = chooseSorcery(state, aiPlayer);
  if (spell) {
    return spell;
  }

  return { kind: "advance-phase" };
}

function applyMainPhaseAction(
  state: MatchState,
  aiPlayer: PlayerId,
  action: AiMainPhaseAction,
): MatchState {
  switch (action.kind) {
    case "play-land":
      return playLand(state, aiPlayer, action.cardId);
    case "summon":
      return summonMonster(state, aiPlayer, action.cardId);
    case "fuse":
      return fuseMonsters(state, aiPlayer, action.parentIds);
    case "upgrade-fusion":
      return upgradeFusion(
        state,
        aiPlayer,
        action.fusionId,
        action.baseMonsterId,
      );
    case "cast-spell":
      return castSpell(
        state,
        aiPlayer,
        action.cardId,
        action.target,
        action.payWith,
      );
    case "advance-phase":
      return advancePhase(state);
  }
}

function chooseSummon(
  state: MatchState,
  aiPlayer: PlayerId,
): BaseMonsterCard | null {
  const player = getPlayer(state, aiPlayer);
  if (player.monsters.length >= 3) {
    return null;
  }

  const readyElements = new Set(
    player.lands
      .filter((land) => land.ready)
      .map((land) => land.card.element),
  );
  const candidates = player.hand.filter(
    (card): card is BaseMonsterCard =>
      card.kind === "monster" &&
      card.category === "base-monster" &&
      readyElements.has(card.element),
  );

  return (
    candidates.find((card) => completesFusionPair(player.monsters, player.extraDeck, card)) ??
    candidates[0] ??
    null
  );
}

function completesFusionPair(
  monsters: readonly MonsterPermanent[],
  extraDeck: MatchState["players"][number]["extraDeck"],
  candidate: BaseMonsterCard,
): boolean {
  return monsters.some((monster) => {
    const card = monster.card;
    return (
      card.category === "base-monster" &&
      extraDeck.some((fusion) =>
        elementsMatch(fusion.elements, card.element, candidate.element),
      )
    );
  });
}

function elementsMatch(
  elements: readonly [Element, Element],
  first: Element,
  second: Element,
): boolean {
  return (
    (elements[0] === first && elements[1] === second) ||
    (elements[0] === second && elements[1] === first)
  );
}

function chooseFusionUpgrade(
  state: MatchState,
  aiPlayer: PlayerId,
): Readonly<{ fusionId: string; baseMonsterId: string }> | null {
  const monsters = getPlayer(state, aiPlayer).monsters;

  for (const fusion of monsters) {
    const fusionCard = fusion.card;
    if (fusionCard.category !== "fusion-monster" || fusionCard.level === 3) {
      continue;
    }

    const baseMonster = monsters.find((monster) => {
      const card = monster.card;
      return (
        card.category === "base-monster" &&
        fusionCard.elements.includes(card.element)
      );
    });
    if (baseMonster) {
      return {
        fusionId: fusionCard.instanceId,
        baseMonsterId: baseMonster.card.instanceId,
      };
    }
  }

  return null;
}

function chooseSorcery(
  state: MatchState,
  aiPlayer: PlayerId,
): Extract<AiAction, { kind: "cast-spell" }> | null {
  const player = getPlayer(state, aiPlayer);
  const payWith = firstReadyElement(state, aiPlayer);
  if (!payWith) {
    return null;
  }

  const bolt = findSpell(player.hand, "bolt");
  if (bolt) {
    const opponentId = opponentOf(aiPlayer);
    const opponent = getPlayer(state, opponentId);
    const fusion = opponent.monsters.find(
      (monster) => monster.card.category === "fusion-monster",
    );
    if (fusion) {
      return spellAction(bolt, payWith, {
        kind: "monster",
        playerId: opponentId,
        monsterId: fusion.card.instanceId,
      });
    }
    if (opponent.life <= 2) {
      return spellAction(bolt, payWith, {
        kind: "player",
        playerId: opponentId,
      });
    }
  }

  const destroy = findSpell(player.hand, "destroy");
  if (!destroy) {
    return null;
  }

  const target = highestAttackMonster(getPlayer(state, opponentOf(aiPlayer)).monsters);
  return target
    ? spellAction(destroy, payWith, {
        kind: "monster",
        playerId: opponentOf(aiPlayer),
        monsterId: target.card.instanceId,
      })
    : null;
}

function spellAction(
  card: SpellCard,
  payWith: Element,
  target: SpellTarget,
): Extract<AiAction, { kind: "cast-spell" }> {
  if (card.id !== "bolt" && card.id !== "destroy") {
    throw new Error(`${card.name} is not an AI sorcery`);
  }
  return {
    kind: "cast-spell",
    cardId: card.instanceId,
    spellId: card.id,
    target,
    payWith,
  };
}

function highestAttackMonster(
  monsters: readonly MonsterPermanent[],
): MonsterPermanent | null {
  return monsters.reduce<MonsterPermanent | null>(
    (highest, monster) =>
      !highest || monster.card.attack > highest.card.attack ? monster : highest,
    null,
  );
}

function chooseAttackers(
  state: MatchState,
  aiPlayer: PlayerId,
): readonly string[] {
  const attackers = getPlayer(state, aiPlayer).monsters.filter(
    (monster) =>
      !hasSummoningSickness(state, monster) &&
      !(
        monster.card.category === "fusion-monster" &&
        monster.card.keyword === "slow"
      ),
  );
  const blockerCount = countLegalBlockers(
    attackers,
    getPlayer(state, opponentOf(aiPlayer)).monsters,
  );

  return blockerCount < attackers.length
    ? attackers.map((monster) => monster.card.instanceId)
    : [];
}

function chooseResponse(
  state: MatchState,
  aiPlayer: PlayerId,
): Extract<AiAction, { kind: "counterspell" | "pass-response" }> {
  const player = getPlayer(state, aiPlayer);
  const counterspell = findSpell(player.hand, "counterspell");
  const payWith = firstReadyElement(state, aiPlayer);
  const target = state.stack.at(-1);

  if (
    counterspell &&
    payWith &&
    target &&
    target.controller !== aiPlayer &&
    shouldCounter(target)
  ) {
    return {
      kind: "counterspell",
      cardId: counterspell.instanceId,
      targetStackId: target.stackId,
      payWith,
    };
  }

  return { kind: "pass-response" };
}

function shouldCounter(item: PendingStackItem): boolean {
  return (
    item.kind === "fusion" ||
    (item.kind === "spell" && item.card.id === "destroy")
  );
}

function applyResponse(
  state: MatchState,
  aiPlayer: PlayerId,
  action: Extract<AiAction, { kind: "counterspell" | "pass-response" }>,
): MatchState {
  return action.kind === "counterspell"
    ? castCounterspell(
        state,
        aiPlayer,
        action.cardId,
        action.targetStackId,
        action.payWith,
      )
    : passResponse(state, aiPlayer);
}

function findSpell(
  cards: MatchState["players"][number]["hand"],
  id: SpellCard["id"],
): SpellCard | null {
  return (
    cards.find(
      (card): card is SpellCard => card.kind === "spell" && card.id === id,
    ) ?? null
  );
}

function firstReadyElement(
  state: MatchState,
  playerId: PlayerId,
): Element | null {
  return getPlayer(state, playerId).lands.find((land) => land.ready)?.card.element ?? null;
}

function result(
  state: MatchState,
  actions: readonly AiAction[],
  waitingFor: AiWaitReason,
): AiTurnResult {
  return {
    state,
    actions,
    attackDeclaration: null,
    waitingFor,
  };
}
