import {
  RulesError,
  dealPlayerDamage,
  getPlayer,
  hasSummoningSickness,
  opponentOf,
  type MatchState,
  type MonsterPermanent,
  type PlayerId,
  type PlayerState,
} from "./core";

export interface AttackDeclaration {
  readonly attackingPlayer: PlayerId;
  readonly defendingPlayer: PlayerId;
  readonly turnNumber: number;
  readonly attackerIds: readonly string[];
}

export interface BlockAssignment {
  readonly attackerId: string;
  readonly blockerId: string;
}

export interface CombatPlan extends AttackDeclaration {
  readonly blocks: readonly BlockAssignment[];
}

/** Returns whether this blocker can legally block this attacker. */
export function canBlock(
  attacker: MonsterPermanent,
  blocker: MonsterPermanent,
): boolean {
  return (
    attacker.card.keyword !== "flying" ||
    blocker.card.keyword === "flying" ||
    blocker.card.keyword === "reach"
  );
}

/**
 * Counts the maximum number of attackers that the supplied blockers can
 * legally cover. Each blocker and attacker may appear in only one block.
 */
export function countLegalBlockers(
  attackers: readonly MonsterPermanent[],
  blockers: readonly MonsterPermanent[],
): number {
  const attackerByBlockerIndex = new Map<number, MonsterPermanent>();

  function assign(attacker: MonsterPermanent, visited: Set<number>): boolean {
    for (let index = 0; index < blockers.length; index += 1) {
      if (visited.has(index) || !canBlock(attacker, blockers[index])) continue;
      visited.add(index);

      const assignedAttacker = attackerByBlockerIndex.get(index);
      if (!assignedAttacker || assign(assignedAttacker, visited)) {
        attackerByBlockerIndex.set(index, attacker);
        return true;
      }
    }
    return false;
  }

  return attackers.reduce((count, attacker) =>
    count + Number(assign(attacker, new Set<number>())), 0);
}

export function declareAttackers(
  state: MatchState,
  attackingPlayer: PlayerId,
  attackerIds: readonly string[],
): AttackDeclaration {
  assertCombatContext(state, attackingPlayer, state.turnNumber);
  assertUnique(attackerIds, "A monster cannot attack more than once");

  const player = getPlayer(state, attackingPlayer);
  for (const attackerId of attackerIds) {
    const attacker = findMonster(player, attackerId, "attacker");
    if (hasSummoningSickness(state, attacker)) {
      throw new RulesError(`${attacker.card.name} has summoning sickness`);
    }
  }

  return {
    attackingPlayer,
    defendingPlayer: opponentOf(attackingPlayer),
    turnNumber: state.turnNumber,
    attackerIds: [...attackerIds],
  };
}

export function assignBlockers(
  state: MatchState,
  defendingPlayer: PlayerId,
  declaration: AttackDeclaration,
  blocks: readonly BlockAssignment[],
): CombatPlan {
  validateDeclarationContext(state, declaration);

  if (declaration.defendingPlayer !== defendingPlayer) {
    throw new RulesError("Only the defending player can assign blockers");
  }

  validateBlocks(state, declaration, blocks);

  return {
    ...declaration,
    blocks: blocks.map((block) => ({ ...block })),
  };
}

export function resolveCombat(
  state: MatchState,
  plan: CombatPlan,
): MatchState {
  validateDeclarationContext(state, plan);
  const declaration = declareAttackers(
    state,
    plan.attackingPlayer,
    plan.attackerIds,
  );
  assignBlockers(state, plan.defendingPlayer, declaration, plan.blocks);

  const attackingPlayer = getPlayer(state, plan.attackingPlayer);
  const defendingPlayer = getPlayer(state, plan.defendingPlayer);
  const blocksByAttacker = new Map(
    plan.blocks.map((block) => [block.attackerId, block.blockerId]),
  );
  const damageToAttackers = new Map<string, number>();
  const damageToBlockers = new Map<string, number>();
  let damageToDefendingPlayer = 0;

  for (const attackerId of plan.attackerIds) {
    const attacker = findMonster(attackingPlayer, attackerId, "attacker");
    const blockerId = blocksByAttacker.get(attackerId);

    if (!blockerId) {
      damageToDefendingPlayer += attacker.card.attack;
      continue;
    }

    const blocker = findMonster(defendingPlayer, blockerId, "blocker");
    damageToBlockers.set(blockerId, attacker.card.attack);
    damageToAttackers.set(attackerId, blocker.card.attack);
    damageToDefendingPlayer += Math.max(
      0,
      attacker.card.attack - blocker.card.health,
    );
  }

  const damagedAttackers = applyMonsterDamage(
    attackingPlayer,
    damageToAttackers,
  );
  const damagedDefenders = applyMonsterDamage(
    defendingPlayer,
    damageToBlockers,
  );
  const playersAfterDeaths: [PlayerState, PlayerState] = [
    state.players[0],
    state.players[1],
  ];
  playersAfterDeaths[playerIndex(plan.attackingPlayer)] = removeDeadMonsters(
    damagedAttackers,
  );
  playersAfterDeaths[playerIndex(plan.defendingPlayer)] = removeDeadMonsters(
    damagedDefenders,
  );

  const stateAfterDeaths: MatchState = {
    ...state,
    players: playersAfterDeaths,
  };
  const resolvedState = dealPlayerDamage(
    stateAfterDeaths,
    plan.defendingPlayer,
    damageToDefendingPlayer,
  );

  return { ...resolvedState, phase: "end" };
}

function validateDeclarationContext(
  state: MatchState,
  declaration: AttackDeclaration,
): void {
  assertCombatContext(
    state,
    declaration.attackingPlayer,
    declaration.turnNumber,
  );

  if (declaration.defendingPlayer !== opponentOf(declaration.attackingPlayer)) {
    throw new RulesError("The combat declaration has the wrong defender");
  }

  assertUnique(
    declaration.attackerIds,
    "A monster cannot attack more than once",
  );

  const attackingPlayer = getPlayer(state, declaration.attackingPlayer);
  for (const attackerId of declaration.attackerIds) {
    const attacker = findMonster(attackingPlayer, attackerId, "attacker");
    if (hasSummoningSickness(state, attacker)) {
      throw new RulesError(`${attacker.card.name} has summoning sickness`);
    }
  }
}

function validateBlocks(
  state: MatchState,
  declaration: AttackDeclaration,
  blocks: readonly BlockAssignment[],
): void {
  const attackerIds = blocks.map((block) => block.attackerId);
  const blockerIds = blocks.map((block) => block.blockerId);
  assertUnique(attackerIds, "Each attacker can have only one blocker");
  assertUnique(blockerIds, "Each blocker can block only one attacker");

  const declaredAttackers = new Set(declaration.attackerIds);
  const defendingPlayer = getPlayer(state, declaration.defendingPlayer);

  for (const block of blocks) {
    if (!declaredAttackers.has(block.attackerId)) {
      throw new RulesError("A blocker must be assigned to a declared attacker");
    }

    const attacker = findMonster(
      getPlayer(state, declaration.attackingPlayer),
      block.attackerId,
      "attacker",
    );
    const blocker = findMonster(defendingPlayer, block.blockerId, "blocker");
    if (!canBlock(attacker, blocker)) {
      throw new RulesError(
        `${blocker.card.name} cannot block a Flying attacker`,
      );
    }
  }
}

function assertCombatContext(
  state: MatchState,
  attackingPlayer: PlayerId,
  turnNumber: number,
): void {
  if (state.result) {
    throw new RulesError("The match is already over");
  }

  if (state.phase !== "combat") {
    throw new RulesError("Combat actions are only legal during the combat phase");
  }

  if (state.activePlayer !== attackingPlayer) {
    throw new RulesError("Only the active player can declare attackers");
  }

  if (state.turnNumber !== turnNumber) {
    throw new RulesError("This combat declaration belongs to another turn");
  }
}

function findMonster(
  player: PlayerState,
  cardId: string,
  role: "attacker" | "blocker",
): MonsterPermanent {
  const monster = player.monsters.find(
    (candidate) => candidate.card.instanceId === cardId,
  );

  if (!monster) {
    throw new RulesError(`${cardId} is not a valid ${role}`);
  }

  return monster;
}

function applyMonsterDamage(
  player: PlayerState,
  damageByCardId: ReadonlyMap<string, number>,
): PlayerState {
  return {
    ...player,
    monsters: player.monsters.map((monster) => ({
      ...monster,
      damage:
        monster.damage +
        (damageByCardId.get(monster.card.instanceId) ?? 0),
    })),
  };
}

function removeDeadMonsters(player: PlayerState): PlayerState {
  const deadMonsters = player.monsters.filter(
    (monster) => monster.damage >= monster.card.health,
  );
  const survivingMonsters = player.monsters.filter(
    (monster) => monster.damage < monster.card.health,
  );

  return {
    ...player,
    monsters: survivingMonsters,
    discardPile: [
      ...player.discardPile,
      ...deadMonsters.map((monster) => monster.card),
    ],
  };
}

function assertUnique(values: readonly string[], message: string): void {
  if (new Set(values).size !== values.length) {
    throw new RulesError(message);
  }
}

function playerIndex(playerId: PlayerId): 0 | 1 {
  return playerId === "player-1" ? 0 : 1;
}
