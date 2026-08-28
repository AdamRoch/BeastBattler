export const ELEMENTS = [
  "fire",
  "water",
  "earth",
  "air",
  "lightning",
] as const;

export type Element = (typeof ELEMENTS)[number];
export type PlayerId = "player-1" | "player-2";
export type BaseCreatureKeyword = "flying" | "reach";
export type TurnPhase = "main" | "combat" | "end";
export type MatchPhase = "mulligan" | TurnPhase;
export type MulliganDecision = "pending" | "kept" | "mulliganed";

interface CardBase {
  readonly instanceId: string;
  readonly name: string;
}

export interface LandCard extends CardBase {
  readonly kind: "land";
  readonly element: Element;
}

export interface BaseMonsterCard extends CardBase {
  readonly kind: "monster";
  readonly category: "base-monster";
  readonly element: Element;
  readonly attack: number;
  readonly health: number;
  readonly level: 1;
  readonly keyword: BaseCreatureKeyword | null;
}

export interface FusionMonsterCard extends CardBase {
  readonly kind: "monster";
  readonly category: "fusion-monster";
  readonly elements: readonly [Element, Element];
  readonly attack: number;
  readonly health: number;
  readonly level: 2 | 3;
  readonly keyword: "burst" | "slow" | null;
}

export type MonsterCard = BaseMonsterCard | FusionMonsterCard;

export interface SpellCard extends CardBase {
  readonly kind: "spell";
  readonly category: "spell";
  readonly id: "bolt" | "destroy" | "draw" | "counterspell";
  readonly cost: 1;
  readonly timing: "sorcery" | "instant";
  readonly effect: SpellEffect;
}

export type SpellEffect =
  | Readonly<{ kind: "damage"; amount: 2; target: "opponent" }>
  | Readonly<{ kind: "destroy"; target: "opponent-monster" }>
  | Readonly<{ kind: "draw"; count: 2 }>
  | Readonly<{
      kind: "counter";
      target: "monster-summon-or-spell";
    }>;

export type SpellTarget =
  | Readonly<{ kind: "player"; playerId: PlayerId }>
  | Readonly<{
      kind: "monster";
      playerId: PlayerId;
      monsterId: string;
    }>;

interface PendingStackItemBase {
  readonly stackId: string;
  readonly controller: PlayerId;
}

export interface PendingSummon extends PendingStackItemBase {
  readonly kind: "summon";
  readonly card: BaseMonsterCard;
}

export interface PendingFusionSummon extends PendingStackItemBase {
  readonly kind: "fusion";
  readonly card: FusionMonsterCard;
  readonly parentNames: readonly [string, string];
}

export interface PendingSpell extends PendingStackItemBase {
  readonly kind: "spell";
  readonly card: SpellCard;
  readonly target: SpellTarget | null;
  readonly targetStackId: string | null;
}

export type PendingStackItem =
  | PendingSummon
  | PendingFusionSummon
  | PendingSpell;

export type GameCard = LandCard | MonsterCard | SpellCard;

export interface LandPermanent {
  readonly card: LandCard;
  readonly ready: boolean;
}

export interface MonsterPermanent {
  readonly card: MonsterCard;
  readonly damage: number;
  readonly summonedOnTurn: number;
  readonly summoningSick: boolean;
}

export interface PlayerState {
  readonly id: PlayerId;
  readonly life: number;
  readonly deck: readonly GameCard[];
  readonly hand: readonly GameCard[];
  readonly discardPile: readonly GameCard[];
  readonly extraDeck: readonly FusionMonsterCard[];
  readonly lands: readonly LandPermanent[];
  readonly monsters: readonly MonsterPermanent[];
  readonly landPlayedThisTurn: boolean;
  readonly mulliganDecision: MulliganDecision;
}

export interface MatchResult {
  readonly winner: PlayerId;
  readonly loser: PlayerId;
  readonly reason: "life" | "deck-out";
}

export interface MatchState {
  readonly players: readonly [PlayerState, PlayerState];
  readonly firstPlayer: PlayerId;
  readonly activePlayer: PlayerId;
  readonly phase: MatchPhase;
  readonly turnNumber: number;
  readonly result: MatchResult | null;
  readonly stack: readonly PendingStackItem[];
  readonly responsePlayer: PlayerId | null;
}

export interface MatchSetup {
  readonly playerOneDeck: readonly GameCard[];
  readonly playerTwoDeck: readonly GameCard[];
  readonly playerOneExtraDeck?: readonly FusionMonsterCard[];
  readonly playerTwoExtraDeck?: readonly FusionMonsterCard[];
  readonly firstPlayer?: PlayerId;
}

const STARTING_LIFE = 10;
const DECK_SIZE = 20;
const OPENING_HAND_SIZE = 4;
const MAX_HAND_SIZE = 7;
const MAX_MONSTERS = 3;

export class RulesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RulesError";
  }
}

export function createMatch({
  playerOneDeck,
  playerTwoDeck,
  playerOneExtraDeck = [],
  playerTwoExtraDeck = [],
  firstPlayer = "player-1",
}: MatchSetup): MatchState {
  validateDeck(playerOneDeck, "Player 1");
  validateDeck(playerTwoDeck, "Player 2");

  return {
    players: [
      createPlayer("player-1", playerOneDeck, playerOneExtraDeck),
      createPlayer("player-2", playerTwoDeck, playerTwoExtraDeck),
    ],
    firstPlayer,
    activePlayer: firstPlayer,
    phase: "mulligan",
    turnNumber: 0,
    result: null,
    stack: [],
    responsePlayer: null,
  };
}

export function getPlayer(
  state: MatchState,
  playerId: PlayerId,
): PlayerState {
  return state.players[playerIndex(playerId)];
}

export function opponentOf(playerId: PlayerId): PlayerId {
  return playerId === "player-1" ? "player-2" : "player-1";
}

export function hasSummoningSickness(
  state: MatchState,
  monster: MonsterPermanent,
): boolean {
  if (!monster.summoningSick) {
    return false;
  }

  return state.turnNumber < monster.summonedOnTurn + state.players.length;
}

export function keepHand(
  state: MatchState,
  playerId: PlayerId,
): MatchState {
  assertMulliganPending(state, playerId);

  const nextState = updatePlayer(state, playerId, (player) => ({
    ...player,
    mulliganDecision: "kept",
  }));

  return startTurnsWhenReady(nextState);
}

export function takeMulligan(
  state: MatchState,
  playerId: PlayerId,
  shuffledDeck: readonly GameCard[],
): MatchState {
  assertMulliganPending(state, playerId);
  const player = getPlayer(state, playerId);
  validateMulliganDeck(player, shuffledDeck);

  const nextState = updatePlayer(state, playerId, (currentPlayer) => ({
    ...currentPlayer,
    deck: shuffledDeck.slice(OPENING_HAND_SIZE),
    hand: shuffledDeck.slice(0, OPENING_HAND_SIZE),
    mulliganDecision: "mulliganed",
  }));

  return startTurnsWhenReady(nextState);
}

export function advancePhase(state: MatchState): MatchState {
  assertMatchActive(state);

  if (state.responsePlayer || state.stack.length > 0) {
    throw new RulesError("Resolve the response window before changing phases");
  }

  switch (state.phase) {
    case "mulligan":
      throw new RulesError("Both players must choose a mulligan action first");
    case "main":
      return { ...state, phase: "combat" };
    case "combat":
      return { ...state, phase: "end" };
    case "end":
      return beginNextTurn(state);
  }
}

export function playLand(
  state: MatchState,
  playerId: PlayerId,
  cardId: string,
): MatchState {
  assertActivePhase(state, playerId, "main");
  const player = getPlayer(state, playerId);

  if (player.landPlayedThisTurn) {
    throw new RulesError("A player may play only one land per turn");
  }

  const handIndex = findCardIndex(player.hand, cardId);
  const card = player.hand[handIndex];

  if (card.kind !== "land") {
    throw new RulesError("Only a land card can be played as a land");
  }

  return updatePlayer(state, playerId, (currentPlayer) => ({
    ...currentPlayer,
    hand: removeAt(currentPlayer.hand, handIndex),
    lands: [...currentPlayer.lands, { card, ready: true }],
    landPlayedThisTurn: true,
  }));
}

export function summonMonster(
  state: MatchState,
  playerId: PlayerId,
  cardId: string,
): MatchState {
  assertActivePhase(state, playerId, "main");
  const player = getPlayer(state, playerId);

  if (player.monsters.length >= MAX_MONSTERS) {
    throw new RulesError("A player cannot control more than three monsters");
  }

  const handIndex = findCardIndex(player.hand, cardId);
  const card = player.hand[handIndex];

  if (card.kind !== "monster" || card.category !== "base-monster") {
    throw new RulesError("Only a base monster card can be summoned");
  }

  const landIndex = player.lands.findIndex(
    (land) => land.ready && land.card.element === card.element,
  );

  if (landIndex === -1) {
    throw new RulesError(`No ${card.element} mana is available`);
  }

  const pendingSummon: PendingSummon = {
    stackId: stackId(state, card.instanceId),
    kind: "summon",
    controller: playerId,
    card,
  };

  const paidState = updatePlayer(state, playerId, (currentPlayer) => ({
    ...currentPlayer,
    hand: removeAt(currentPlayer.hand, handIndex),
    lands: currentPlayer.lands.map((land, index) =>
      index === landIndex ? { ...land, ready: false } : land,
    ),
  }));

  return {
    ...paidState,
    stack: [pendingSummon],
    responsePlayer: opponentOf(playerId),
  };
}

export function availableMana(
  state: MatchState,
  playerId: PlayerId,
): Readonly<Record<Element, number>> {
  const mana: Record<Element, number> = {
    fire: 0,
    water: 0,
    earth: 0,
    air: 0,
    lightning: 0,
  };

  for (const land of getPlayer(state, playerId).lands) {
    if (land.ready) {
      mana[land.card.element] += 1;
    }
  }

  return mana;
}

export function drawCards(
  state: MatchState,
  playerId: PlayerId,
  count: number,
): MatchState {
  assertMatchActive(state);

  if (!Number.isInteger(count) || count < 0) {
    throw new RulesError("Draw count must be a non-negative integer");
  }

  let nextState = state;

  for (let drawn = 0; drawn < count; drawn += 1) {
    const player = getPlayer(nextState, playerId);
    const card = player.deck[0];

    if (!card) {
      return endMatch(nextState, playerId, "deck-out");
    }

    nextState = updatePlayer(nextState, playerId, (currentPlayer) => ({
      ...currentPlayer,
      deck: currentPlayer.deck.slice(1),
      hand: [...currentPlayer.hand, card],
    }));
  }

  return nextState;
}

export function discardToHandLimit(
  state: MatchState,
  playerId: PlayerId,
  cardIds: readonly string[],
): MatchState {
  assertActivePhase(state, playerId, "end");
  const player = getPlayer(state, playerId);
  const requiredDiscards = Math.max(0, player.hand.length - MAX_HAND_SIZE);

  if (cardIds.length !== requiredDiscards) {
    throw new RulesError(
      `Discard exactly ${requiredDiscards} card${requiredDiscards === 1 ? "" : "s"}`,
    );
  }

  const selectedIds = new Set(cardIds);
  if (selectedIds.size !== cardIds.length) {
    throw new RulesError("A card cannot be discarded more than once");
  }

  for (const cardId of selectedIds) {
    findCardIndex(player.hand, cardId);
  }

  const discarded = player.hand.filter((card) =>
    selectedIds.has(card.instanceId),
  );
  const kept = player.hand.filter(
    (card) => !selectedIds.has(card.instanceId),
  );

  return updatePlayer(state, playerId, (currentPlayer) => ({
    ...currentPlayer,
    hand: kept,
    discardPile: [...currentPlayer.discardPile, ...discarded],
  }));
}

export function dealPlayerDamage(
  state: MatchState,
  playerId: PlayerId,
  amount: number,
): MatchState {
  assertMatchActive(state);

  if (!Number.isInteger(amount) || amount < 0) {
    throw new RulesError("Damage must be a non-negative integer");
  }

  const damagedState = updatePlayer(state, playerId, (player) => ({
    ...player,
    life: Math.max(0, player.life - amount),
  }));

  return getPlayer(damagedState, playerId).life === 0
    ? endMatch(damagedState, playerId, "life")
    : damagedState;
}

function createPlayer(
  id: PlayerId,
  orderedDeck: readonly GameCard[],
  extraDeck: readonly FusionMonsterCard[],
): PlayerState {
  return {
    id,
    life: STARTING_LIFE,
    deck: orderedDeck.slice(OPENING_HAND_SIZE),
    hand: orderedDeck.slice(0, OPENING_HAND_SIZE),
    discardPile: [],
    extraDeck: [...extraDeck],
    lands: [],
    monsters: [],
    landPlayedThisTurn: false,
    mulliganDecision: "pending",
  };
}

function startTurnsWhenReady(state: MatchState): MatchState {
  const allPlayersReady = state.players.every(
    (player) => player.mulliganDecision !== "pending",
  );

  if (!allPlayersReady) {
    return state;
  }

  return {
    ...state,
    activePlayer: state.firstPlayer,
    phase: "main",
    turnNumber: 1,
  };
}

function beginNextTurn(state: MatchState): MatchState {
  const activePlayer = getPlayer(state, state.activePlayer);

  if (activePlayer.hand.length > MAX_HAND_SIZE) {
    throw new RulesError("Discard down to seven cards before ending the turn");
  }

  const nextPlayerId = opponentOf(state.activePlayer);
  const damageClearedState: MatchState = {
    ...state,
    players: [
      clearMonsterDamage(state.players[0]),
      clearMonsterDamage(state.players[1]),
    ],
  };
  const readiedState = updatePlayer(
    damageClearedState,
    nextPlayerId,
    (player) => ({
    ...player,
    lands: player.lands.map((land) => ({ ...land, ready: true })),
    monsters: player.monsters.map((monster) => ({
      ...monster,
      summoningSick: false,
    })),
    landPlayedThisTurn: false,
    }),
  );
  const nextTurnState: MatchState = {
    ...readiedState,
    activePlayer: nextPlayerId,
    turnNumber: state.turnNumber + 1,
  };

  const drawnState = drawCards(nextTurnState, nextPlayerId, 1);
  if (drawnState.result) {
    return drawnState;
  }

  return { ...drawnState, phase: "main" };
}

function clearMonsterDamage(player: PlayerState): PlayerState {
  return {
    ...player,
    monsters: player.monsters.map((monster) => ({
      ...monster,
      damage: 0,
    })),
  };
}

function endMatch(
  state: MatchState,
  loser: PlayerId,
  reason: MatchResult["reason"],
): MatchState {
  return {
    ...state,
    result: {
      winner: opponentOf(loser),
      loser,
      reason,
    },
  };
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
  const index = playerIndex(playerId);
  players[index] = update(players[index]);
  return { ...state, players };
}

function removeAt<T>(items: readonly T[], index: number): readonly T[] {
  return [...items.slice(0, index), ...items.slice(index + 1)];
}

function findCardIndex(cards: readonly GameCard[], cardId: string): number {
  const index = cards.findIndex((card) => card.instanceId === cardId);

  if (index === -1) {
    throw new RulesError(`Card ${cardId} is not in the player's hand`);
  }

  return index;
}

function playerIndex(playerId: PlayerId): 0 | 1 {
  return playerId === "player-1" ? 0 : 1;
}

function assertMatchActive(state: MatchState): void {
  if (state.result) {
    throw new RulesError("The match is already over");
  }
}

function assertMulliganPending(
  state: MatchState,
  playerId: PlayerId,
): void {
  assertMatchActive(state);

  if (state.phase !== "mulligan") {
    throw new RulesError("Mulligans are only available before the first turn");
  }

  if (getPlayer(state, playerId).mulliganDecision !== "pending") {
    throw new RulesError("Each player gets only one mulligan decision");
  }
}

function assertActivePhase(
  state: MatchState,
  playerId: PlayerId,
  phase: TurnPhase,
): void {
  assertMatchActive(state);

  if (state.activePlayer !== playerId) {
    throw new RulesError("Only the active player can take this action");
  }

  if (state.phase !== phase) {
    throw new RulesError(`This action is only legal during the ${phase} phase`);
  }

  if (state.responsePlayer || state.stack.length > 0) {
    throw new RulesError("Resolve the response window before taking another action");
  }
}

function stackId(state: MatchState, cardId: string): string {
  return `${state.turnNumber}:${state.stack.length + 1}:${cardId}`;
}

function validateDeck(deck: readonly GameCard[], label: string): void {
  if (deck.length !== DECK_SIZE) {
    throw new RulesError(`${label} must have exactly ${DECK_SIZE} cards`);
  }

  const ids = new Set(deck.map((card) => card.instanceId));
  if (ids.size !== deck.length || ids.has("")) {
    throw new RulesError(`${label} card instance IDs must be unique and non-empty`);
  }

  if (
    deck.some(
      (card) => card.kind === "monster" && card.category === "fusion-monster",
    )
  ) {
    throw new RulesError(`${label} cannot contain fusion monsters`);
  }
}

function validateMulliganDeck(
  player: PlayerState,
  shuffledDeck: readonly GameCard[],
): void {
  if (shuffledDeck.length !== DECK_SIZE) {
    throw new RulesError(
      `A mulligan shuffle must contain all ${DECK_SIZE} cards`,
    );
  }

  const currentIds = new Set(
    [...player.hand, ...player.deck].map((card) => card.instanceId),
  );
  const shuffledIds = new Set(shuffledDeck.map((card) => card.instanceId));

  if (
    shuffledIds.size !== DECK_SIZE ||
    [...currentIds].some((cardId) => !shuffledIds.has(cardId))
  ) {
    throw new RulesError("A mulligan must shuffle the player's original deck");
  }
}
