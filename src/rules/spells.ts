import {
  RulesError,
  dealPlayerDamage,
  drawCards,
  getPlayer,
  opponentOf,
  type Element,
  type MatchState,
  type MonsterPermanent,
  type PendingSpell,
  type PendingStackItem,
  type PlayerId,
  type PlayerState,
  type SpellCard,
  type SpellTarget,
} from "./core";

export interface CounterspellResponse {
  readonly card: SpellCard;
  readonly payWith: Element;
}

/**
 * Returns the Counterspell and mana the responding player can use now, if any.
 * The response prompt uses this rather than independently guessing at card or
 * mana availability.
 */
export function availableCounterspellResponse(
  state: MatchState,
  playerId: PlayerId,
): CounterspellResponse | null {
  if (!canAddCounterspell(state, playerId)) {
    return null;
  }

  const player = getPlayer(state, playerId);
  const card = player.hand.find(
    (candidate): candidate is SpellCard =>
      candidate.kind === "spell" && candidate.id === "counterspell",
  );
  const payWith = player.lands.find((land) => land.ready)?.card.element;

  return card && payWith ? { card, payWith } : null;
}

export function castSpell(
  state: MatchState,
  playerId: PlayerId,
  spellCardId: string,
  target: SpellTarget | null,
  payWith: Element,
): MatchState {
  assertSorceryWindow(state, playerId);
  const player = getPlayer(state, playerId);
  const spell = findSpellInHand(player, spellCardId);

  if (spell.id === "counterspell") {
    throw new RulesError("Counterspell can only be cast in a response window");
  }

  validateSpellTarget(state, spell, target);
  const pendingSpell: PendingSpell = {
    stackId: stackId(state, spell.instanceId),
    kind: "spell",
    controller: playerId,
    card: spell,
    target,
    targetStackId: null,
  };
  const paidState = payForSpell(state, playerId, spell, payWith);

  return {
    ...paidState,
    stack: [pendingSpell],
    responsePlayer: opponentOf(playerId),
  };
}

export function castCounterspell(
  state: MatchState,
  playerId: PlayerId,
  counterspellCardId: string,
  targetStackId: string,
  payWith: Element,
): MatchState {
  assertCounterspellWindow(state, playerId);
  const player = getPlayer(state, playerId);
  const counterspell = findSpellInHand(player, counterspellCardId);

  if (counterspell.id !== "counterspell") {
    throw new RulesError("Only Counterspell can be cast in a response window");
  }

  const topItem = state.stack.at(-1);
  if (!topItem || topItem.stackId !== targetStackId) {
    throw new RulesError("Counterspell must target the top stack item");
  }

  if (topItem.controller === playerId) {
    throw new RulesError("Counterspell must target an opponent's action");
  }

  if (state.stack.length >= 3) {
    throw new RulesError("The stack cannot exceed three pending items");
  }

  if (
    state.stack.length === 2 &&
    (topItem.kind !== "spell" || topItem.card.id !== "counterspell")
  ) {
    throw new RulesError(
      "Only a Counterspell targeting Counterspell may be the third item",
    );
  }

  const pendingCounterspell: PendingSpell = {
    stackId: stackId(state, counterspell.instanceId),
    kind: "spell",
    controller: playerId,
    card: counterspell,
    target: null,
    targetStackId,
  };
  const paidState = payForSpell(
    state,
    playerId,
    counterspell,
    payWith,
  );

  return {
    ...paidState,
    stack: [...state.stack, pendingCounterspell],
    responsePlayer: opponentOf(playerId),
  };
}

export function passResponse(
  state: MatchState,
  playerId: PlayerId,
): MatchState {
  if (state.responsePlayer !== playerId || state.stack.length === 0) {
    throw new RulesError("This player does not have response priority");
  }

  const pendingItems = state.stack;
  let resolvedState: MatchState = {
    ...state,
    stack: [],
    responsePlayer: null,
  };
  const counteredStackIds = new Set<string>();

  for (let index = pendingItems.length - 1; index >= 0; index -= 1) {
    const item = pendingItems[index];

    if (counteredStackIds.has(item.stackId)) {
      if (item.kind === "summon" || item.kind === "fusion") {
        resolvedState = discardCounteredSummon(resolvedState, item);
      }
      continue;
    }

    if (item.kind === "summon") {
      resolvedState = resolveSummon(resolvedState, item);
      continue;
    }

    if (item.kind === "fusion") {
      resolvedState = resolveFusionSummon(resolvedState, item);
      continue;
    }

    if (item.card.id === "counterspell") {
      if (!item.targetStackId) {
        throw new RulesError("Counterspell has no stack target");
      }
      counteredStackIds.add(item.targetStackId);
      continue;
    }

    resolvedState = resolveSpell(resolvedState, item);
  }

  return resolvedState;
}

function resolveSpell(state: MatchState, item: PendingSpell): MatchState {
  switch (item.card.id) {
    case "bolt":
      if (!item.target) {
        throw new RulesError("Bolt has no target");
      }
      return item.target.kind === "player"
        ? dealPlayerDamage(state, item.target.playerId, 2)
        : damageMonster(state, item.target.playerId, item.target.monsterId, 2);
    case "destroy":
      if (!item.target || item.target.kind !== "monster") {
        throw new RulesError("Destroy has no monster target");
      }
      return destroyMonster(
        state,
        item.target.playerId,
        item.target.monsterId,
      );
    case "draw":
      return drawCards(state, item.controller, 2);
    case "counterspell":
      throw new RulesError("Counterspell must resolve against the stack");
  }
}

function resolveSummon(
  state: MatchState,
  item: Extract<PendingStackItem, { kind: "summon" }>,
): MatchState {
  return updatePlayer(state, item.controller, (player) => ({
    ...player,
    monsters: [
      ...player.monsters,
      {
        card: item.card,
        damage: 0,
        summonedOnTurn: state.turnNumber,
        summoningSick: true,
      },
    ],
  }));
}

function discardCounteredSummon(
  state: MatchState,
  item: Extract<PendingStackItem, { kind: "summon" | "fusion" }>,
): MatchState {
  return updatePlayer(state, item.controller, (player) => ({
    ...player,
    discardPile: [...player.discardPile, item.card],
  }));
}

function resolveFusionSummon(
  state: MatchState,
  item: Extract<PendingStackItem, { kind: "fusion" }>,
): MatchState {
  const summonedState = updatePlayer(state, item.controller, (player) => ({
    ...player,
    monsters: [
      ...player.monsters,
      {
        card: item.card,
        damage: 0,
        summonedOnTurn: state.turnNumber,
        summoningSick: item.card.keyword === "slow",
      },
    ],
  }));

  return item.card.keyword === "burst"
    ? dealPlayerDamage(summonedState, opponentOf(item.controller), 1)
    : summonedState;
}

function damageMonster(
  state: MatchState,
  playerId: PlayerId,
  monsterId: string,
  amount: number,
): MatchState {
  const player = getPlayer(state, playerId);
  const target = findMonster(player, monsterId);
  const damage = target.damage + amount;

  if (damage >= target.card.health) {
    return destroyMonster(state, playerId, monsterId);
  }

  return updatePlayer(state, playerId, (currentPlayer) => ({
    ...currentPlayer,
    monsters: currentPlayer.monsters.map((monster) =>
      monster.card.instanceId === monsterId
        ? { ...monster, damage }
        : monster,
    ),
  }));
}

function destroyMonster(
  state: MatchState,
  playerId: PlayerId,
  monsterId: string,
): MatchState {
  const player = getPlayer(state, playerId);
  const target = findMonster(player, monsterId);

  return updatePlayer(state, playerId, (currentPlayer) => ({
    ...currentPlayer,
    monsters: currentPlayer.monsters.filter(
      (monster) => monster.card.instanceId !== monsterId,
    ),
    discardPile: [...currentPlayer.discardPile, target.card],
  }));
}

function validateSpellTarget(
  state: MatchState,
  spell: SpellCard,
  target: SpellTarget | null,
): void {
  switch (spell.id) {
    case "bolt":
      if (!target) {
        throw new RulesError("Bolt requires a player or monster target");
      }
      if (target.kind === "monster") {
        findMonster(getPlayer(state, target.playerId), target.monsterId);
      }
      return;
    case "destroy":
      if (!target || target.kind !== "monster") {
        throw new RulesError("Destroy requires a monster target");
      }
      findMonster(getPlayer(state, target.playerId), target.monsterId);
      return;
    case "draw":
      if (target) {
        throw new RulesError("Draw does not take a target");
      }
      return;
    case "counterspell":
      throw new RulesError("Counterspell requires a response window");
  }
}

function assertSorceryWindow(state: MatchState, playerId: PlayerId): void {
  if (state.result) {
    throw new RulesError("The match is already over");
  }
  if (state.activePlayer !== playerId || state.phase !== "main") {
    throw new RulesError("Sorceries are only legal in your own main phase");
  }
  if (state.responsePlayer || state.stack.length > 0) {
    throw new RulesError("Resolve the response window before casting a sorcery");
  }
}

function assertCounterspellWindow(
  state: MatchState,
  playerId: PlayerId,
): void {
  if (state.result) {
    throw new RulesError("The match is already over");
  }
  if (state.responsePlayer !== playerId || state.stack.length === 0) {
    throw new RulesError("Counterspell requires response priority");
  }
}

function canAddCounterspell(state: MatchState, playerId: PlayerId): boolean {
  const topItem = state.stack.at(-1);
  if (
    state.result ||
    state.responsePlayer !== playerId ||
    !topItem ||
    topItem.controller === playerId ||
    state.stack.length >= 3
  ) {
    return false;
  }

  return state.stack.length !== 2 ||
    (topItem.kind === "spell" && topItem.card.id === "counterspell");
}

function payForSpell(
  state: MatchState,
  playerId: PlayerId,
  spell: SpellCard,
  payWith: Element,
): MatchState {
  const player = getPlayer(state, playerId);
  const handIndex = player.hand.findIndex(
    (card) => card.instanceId === spell.instanceId,
  );
  const landIndex = player.lands.findIndex(
    (land) => land.ready && land.card.element === payWith,
  );

  if (landIndex === -1) {
    throw new RulesError(`No unused ${payWith} land is available`);
  }

  return updatePlayer(state, playerId, (currentPlayer) => ({
    ...currentPlayer,
    hand: [
      ...currentPlayer.hand.slice(0, handIndex),
      ...currentPlayer.hand.slice(handIndex + 1),
    ],
    lands: currentPlayer.lands.map((land, index) =>
      index === landIndex ? { ...land, ready: false } : land,
    ),
    discardPile: [...currentPlayer.discardPile, spell],
  }));
}

function findSpellInHand(
  player: PlayerState,
  spellCardId: string,
): SpellCard {
  const card = player.hand.find(
    (candidate) => candidate.instanceId === spellCardId,
  );

  if (!card || card.kind !== "spell") {
    throw new RulesError(`${spellCardId} is not a spell in this hand`);
  }

  return card;
}

function findMonster(
  player: PlayerState,
  monsterId: string,
): MonsterPermanent {
  const monster = player.monsters.find(
    (candidate) => candidate.card.instanceId === monsterId,
  );

  if (!monster) {
    throw new RulesError(`${monsterId} is not a monster on this field`);
  }

  return monster;
}

function updatePlayer(
  state: MatchState,
  playerId: PlayerId,
  update: (player: PlayerState) => PlayerState,
): MatchState {
  const players: [PlayerState, PlayerState] = [
    state.players[0],
    state.players[1],
  ];
  const index = playerId === "player-1" ? 0 : 1;
  players[index] = update(players[index]);
  return { ...state, players };
}

function stackId(state: MatchState, cardId: string): string {
  return `${state.turnNumber}:${state.stack.length + 1}:${cardId}`;
}
