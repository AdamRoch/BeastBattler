import {
  RulesError,
  dealPlayerDamage,
  getPlayer,
  opponentOf,
  type BaseMonsterCard,
  type FusionMonsterCard,
  type MatchState,
  type MonsterPermanent,
  type PendingFusionSummon,
  type PlayerId,
  type PlayerState,
} from "./core";

type BaseMonsterPermanent = MonsterPermanent & {
  readonly card: BaseMonsterCard;
};

type FusionMonsterPermanent = MonsterPermanent & {
  readonly card: FusionMonsterCard;
};

export interface FusionOption {
  readonly parentIds: readonly [string, string];
  readonly fusionCardId: string;
  readonly fusionName: string;
}

export function findFusionOptions(
  state: MatchState,
  playerId: PlayerId,
): readonly FusionOption[] {
  assertMainPhase(state, playerId);
  const player = getPlayer(state, playerId);
  const baseMonsters = player.monsters.filter(isBaseMonsterPermanent);
  const options: FusionOption[] = [];

  for (let firstIndex = 0; firstIndex < baseMonsters.length; firstIndex += 1) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < baseMonsters.length;
      secondIndex += 1
    ) {
      const firstParent = baseMonsters[firstIndex];
      const secondParent = baseMonsters[secondIndex];
      const fusionCard = findMatchingFusion(
        player.extraDeck,
        firstParent.card.element,
        secondParent.card.element,
      );

      if (fusionCard) {
        options.push({
          parentIds: [
            firstParent.card.instanceId,
            secondParent.card.instanceId,
          ],
          fusionCardId: fusionCard.instanceId,
          fusionName: fusionCard.name,
        });
      }
    }
  }

  return options;
}

export function fuseMonsters(
  state: MatchState,
  playerId: PlayerId,
  parentIds: readonly [string, string],
): MatchState {
  assertMainPhase(state, playerId);

  if (parentIds[0] === parentIds[1]) {
    throw new RulesError("Fusion requires two different base monsters");
  }

  const player = getPlayer(state, playerId);
  const firstParent = findBaseMonster(player, parentIds[0]);
  const secondParent = findBaseMonster(player, parentIds[1]);
  const fusionCard = findMatchingFusion(
    player.extraDeck,
    firstParent.card.element,
    secondParent.card.element,
  );

  if (!fusionCard) {
    throw new RulesError("No matching fusion is available in the extra deck");
  }

  const consumedIds = new Set(parentIds);
  const consumedParents = player.monsters.filter((monster) =>
    consumedIds.has(monster.card.instanceId),
  );
  const pendingFusion: PendingFusionSummon = {
    stackId: `${state.turnNumber}:1:${fusionCard.instanceId}`,
    kind: "fusion",
    controller: playerId,
    card: fusionCard,
  };
  const fusedState = updatePlayer(state, playerId, (currentPlayer) => ({
    ...currentPlayer,
    monsters: currentPlayer.monsters.filter(
      (monster) => !consumedIds.has(monster.card.instanceId),
    ),
    discardPile: [
      ...currentPlayer.discardPile,
      ...consumedParents.map((monster) => monster.card),
    ],
    extraDeck: currentPlayer.extraDeck.filter(
      (card) => card.instanceId !== fusionCard.instanceId,
    ),
  }));

  return {
    ...fusedState,
    stack: [pendingFusion],
    responsePlayer: opponentOf(playerId),
  };
}

export function upgradeFusion(
  state: MatchState,
  playerId: PlayerId,
  fusionCardId: string,
  baseMonsterCardId: string,
): MatchState {
  assertMainPhase(state, playerId);
  const player = getPlayer(state, playerId);
  const fusion = findFusionMonster(player, fusionCardId);

  if (fusion.card.level === 3) {
    throw new RulesError("This fusion is already at level 3");
  }

  const baseMonster = findBaseMonster(player, baseMonsterCardId);
  if (!fusion.card.elements.includes(baseMonster.card.element)) {
    throw new RulesError(
      "The absorbed monster must share an element with the fusion",
    );
  }

  const upgradedCard: FusionMonsterCard = {
    ...fusion.card,
    attack: fusion.card.attack + 1,
    health: fusion.card.health + 1,
    level: 3,
  };
  const upgradedState = updatePlayer(state, playerId, (currentPlayer) => ({
    ...currentPlayer,
    monsters: currentPlayer.monsters
      .filter(
        (monster) => monster.card.instanceId !== baseMonster.card.instanceId,
      )
      .map((monster) =>
        monster.card.instanceId === fusion.card.instanceId
          ? { ...monster, card: upgradedCard }
          : monster,
      ),
    discardPile: [...currentPlayer.discardPile, baseMonster.card],
  }));

  return applyBurst(upgradedState, playerId, upgradedCard);
}

function applyBurst(
  state: MatchState,
  playerId: PlayerId,
  fusionCard: FusionMonsterCard,
): MatchState {
  return fusionCard.keyword === "burst"
    ? dealPlayerDamage(state, opponentOf(playerId), 1)
    : state;
}

function findBaseMonster(
  player: PlayerState,
  cardId: string,
): BaseMonsterPermanent {
  const monster = player.monsters.find(
    (candidate) => candidate.card.instanceId === cardId,
  );

  if (!monster || !isBaseMonsterPermanent(monster)) {
    throw new RulesError(`${cardId} is not a base monster on this field`);
  }

  return monster;
}

function findFusionMonster(
  player: PlayerState,
  cardId: string,
): FusionMonsterPermanent {
  const monster = player.monsters.find(
    (candidate) => candidate.card.instanceId === cardId,
  );

  if (!monster || !isFusionMonsterPermanent(monster)) {
    throw new RulesError(`${cardId} is not a fusion monster on this field`);
  }

  return monster;
}

function findMatchingFusion(
  extraDeck: readonly FusionMonsterCard[],
  firstElement: BaseMonsterCard["element"],
  secondElement: BaseMonsterCard["element"],
): FusionMonsterCard | undefined {
  return extraDeck.find(
    (fusionCard) =>
      (fusionCard.elements[0] === firstElement &&
        fusionCard.elements[1] === secondElement) ||
      (fusionCard.elements[0] === secondElement &&
        fusionCard.elements[1] === firstElement),
  );
}

function isBaseMonsterPermanent(
  monster: MonsterPermanent,
): monster is BaseMonsterPermanent {
  return monster.card.category === "base-monster";
}

function isFusionMonsterPermanent(
  monster: MonsterPermanent,
): monster is FusionMonsterPermanent {
  return monster.card.category === "fusion-monster";
}

function assertMainPhase(state: MatchState, playerId: PlayerId): void {
  if (state.result) {
    throw new RulesError("The match is already over");
  }

  if (state.activePlayer !== playerId) {
    throw new RulesError("Only the active player can perform a fusion action");
  }

  if (state.phase !== "main") {
    throw new RulesError("Fusion actions are only legal during the main phase");
  }

  if (state.responsePlayer || state.stack.length > 0) {
    throw new RulesError("Resolve the response window before fusing");
  }
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
