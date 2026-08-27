import { runAiTurn, type AiAction } from "../ai/opponent";
import type { ArenaScene, AnimationAnchor } from "../arena";
import {
  CARD_ART_IDS,
  createCardArtRenderer,
  type CardArtId,
} from "../card-art";
import {
  ARCHETYPES,
  assembleDeck,
  deriveExtraDeck,
  type ArchetypeId,
} from "../cards/catalog";
import { createMonsterModel, type AssignedMonsterId } from "../models";
import {
  advancePhase,
  createMatch,
  discardToHandLimit,
  getPlayer,
  hasSummoningSickness,
  keepHand,
  playLand,
  summonMonster,
  takeMulligan,
  type Element,
  type FusionMonsterCard,
  type GameCard,
  type MatchState,
  type MatchResult,
  type MonsterPermanent,
  type PendingStackItem,
  type PlayerId,
  type SpellCard,
  type SpellTarget,
} from "../rules/core";
import {
  assignBlockers,
  declareAttackers,
  resolveCombat,
  type AttackDeclaration,
  type BlockAssignment,
  type CombatPlan,
} from "../rules/combat";
import {
  findFusionOptions,
  fuseMonsters,
  upgradeFusion,
  type FusionOption,
} from "../rules/fusion";
import {
  castCounterspell,
  castSpell,
  passResponse,
} from "../rules/spells";
import { resolveStackEvents } from "./events";
import { boardZoneMarkup } from "./board-zone";
import {
  privacyCurtainForTransition,
  privacyCurtainMarkup,
  type PrivacyCurtainReason,
  type PrivacyCurtainRequest,
} from "./privacy-curtain";
import type { SfxEngine } from "../sfx";
import type { MatchIntent } from "../server/protocol";

const HUMAN: PlayerId = "player-1";
const AI: PlayerId = "player-2";
const HUMAN_ARCHETYPE: ArchetypeId = "fire-water";
const AI_ARCHETYPE: ArchetypeId = "earth-lightning";
const EMPTY_COMBAT_DELAY_MS = 800;

interface PendingTarget {
  readonly cardId: string;
  readonly spellId: "bolt" | "destroy";
}

interface FusionUpgradeOption {
  readonly fusionId: string;
  readonly fusionName: string;
  readonly baseMonsterId: string;
  readonly baseMonsterName: string;
}

export interface MatchController {
  getState(): MatchState;
  dispose(): void;
}

export type MatchMode = "ai" | "hotseat";

export interface OnlineMatchUpdate {
  readonly state?: MatchState;
  readonly combat?: AttackDeclaration | null;
  readonly notice?: string;
}

/**
 * The online controller never changes its MatchState itself. This adapter
 * supplies server-filtered snapshots and receives the player's intents.
 */
export interface OnlineMatchAdapter {
  getState(): MatchState | null;
  subscribe(listener: (update: OnlineMatchUpdate) => void): () => void;
  sendIntent(intent: MatchIntent): void;
  requestRematch(): void;
  leaveMatch(): void;
}

export interface MatchControllerOptions {
  readonly mode?: MatchMode | "online";
  readonly playerOneArchetype?: ArchetypeId;
  readonly playerTwoArchetype?: ArchetypeId;
  readonly onComplete?: (result: MatchResult) => void;
  readonly sfx?: SfxEngine;
  readonly online?: OnlineMatchAdapter;
}

export function mountMatch(
  root: HTMLElement,
  arena: ArenaScene,
  options: MatchControllerOptions = {},
): MatchController {
  const mode = options.mode ?? "ai";
  const online = options.online;
  if (mode === "online" && !online) {
    throw new Error("Online matches require an authoritative match adapter");
  }
  const playerOneArchetype = options.playerOneArchetype ?? HUMAN_ARCHETYPE;
  const playerTwoArchetype = options.playerTwoArchetype ?? AI_ARCHETYPE;
  const art = createCardArtRenderer({ width: 176, height: 246 });
  const hud = document.createElement("div");
  hud.className = "match-hud";
  root.append(hud);

  const initialExtraDecks: Record<PlayerId, readonly FusionMonsterCard[]> = {
    "player-1": deriveExtraDeck(playerOneArchetype),
    "player-2": deriveExtraDeck(playerTwoArchetype),
  };
  let state = online?.getState() ?? newMatch();
  let viewingPlayer: PlayerId = HUMAN;
  let privacyCurtain: PrivacyCurtainRequest | null = mode === "hotseat"
    ? { playerId: HUMAN, reason: "turn" }
    : null;
  let selectedAttackers = new Set<string>();
  let pendingTarget: PendingTarget | null = null;
  let pendingAttack: AttackDeclaration | null = null;
  let dismissedFusionKey = "";
  let notice = "Choose Keep or Mulligan to begin.";
  let aiTimer: number | undefined;
  let emptyCombatTimer: number | undefined;
  let disposed = false;
  let completionReported = false;
  let resultSfxPlayed = false;
  let audioPhase = `${state.turnNumber}:${state.phase}`;
  const audibleLife: Record<PlayerId, number> = {
    "player-1": getPlayer(state, HUMAN).life,
    "player-2": getPlayer(state, AI).life,
  };
  const animationTimers = new Set<number>();
  const sceneIds = new Set<string>();
  const retainedSceneIds = new Set<string>();
  const pendingFusionSources = new Map<string, readonly [string, string]>();
  let unsubscribeOnline = () => {};

  arena.setSideElement("player", primaryElement(playerOneArchetype));
  arena.setSideElement("opponent", primaryElement(playerTwoArchetype));
  if (mode === "hotseat") {
    options.sfx?.play("curtain");
  }

  function newMatch(): MatchState {
    return createMatch({
      playerOneDeck: playableDeck(playerOneArchetype),
      playerTwoDeck: playableDeck(playerTwoArchetype),
      playerOneExtraDeck: deriveExtraDeck(playerOneArchetype),
      playerTwoExtraDeck: deriveExtraDeck(playerTwoArchetype),
      firstPlayer: HUMAN,
    });
  }

  function localPlayerId(): PlayerId {
    return mode === "hotseat" ? viewingPlayer : HUMAN;
  }

  function showPrivacyCurtain(
    playerId: PlayerId,
    reason: PrivacyCurtainReason,
  ): void {
    if (mode !== "hotseat") {
      return;
    }
    viewingPlayer = playerId;
    selectedAttackers.clear();
    pendingTarget = null;
    privacyCurtain = { playerId, reason };
    options.sfx?.play("curtain");
  }

  function privacyTransition(before: MatchState, after: MatchState): void {
    if (mode !== "hotseat") {
      return;
    }
    const request = privacyCurtainForTransition(before, after, viewingPlayer);
    if (request) {
      showPrivacyCurtain(request.playerId, request.reason);
    }
  }

  function render(): void {
    syncMatchSfx();
    const playerOne = getPlayer(state, HUMAN);
    const playerTwo = getPlayer(state, AI);
    const localId = localPlayerId();
    const local = getPlayer(state, localId);
    const handIsPrivate = mode === "hotseat" && privacyCurtain !== null;
    const fusionOptions = availableFusions(localId);
    const upgradeOptions = availableUpgrades(localId);
    const initialExtraDeck = initialExtraDecks[localId];
    const priorityPlayer = state.responsePlayer ?? state.activePlayer;
    const fusionKey = fusionOptions
      .map((option) => option.parentIds.join("+"))
      .join("|");
    const showFusionPrompt =
      fusionOptions.length > 0 && fusionKey !== dismissedFusionKey;

    hud.innerHTML = `
      <header class="match-topbar">
        <section class="life-panel life-player" data-testid="player-life">
          <span class="life-label">${mode === "hotseat" ? "PLAYER 1" : "YOU"}</span>
          <strong>${playerOne.life}</strong>
          <small>LP</small>
        </section>
        <section class="turn-panel">
          <span>TURN ${state.turnNumber || "SETUP"}</span>
          <strong>${phaseLabel(state)}</strong>
          <small>${mode === "hotseat" ? `PLAYER ${priorityPlayer === HUMAN ? 1 : 2} PRIORITY` : state.activePlayer === HUMAN ? "YOUR PRIORITY" : "OPPONENT PRIORITY"}</small>
        </section>
        <section class="life-panel life-opponent" data-testid="opponent-life">
          <span class="life-label">${mode === "hotseat" ? "PLAYER 2" : "AI"}</span>
          <strong>${playerTwo.life}</strong>
          <small>LP</small>
        </section>
      </header>

      <aside class="extra-deck-panel" aria-label="Extra deck">
        <div class="panel-heading">
          <span>EXTRA DECK</span>
          <small>3 fusion targets</small>
        </div>
        <div class="extra-deck-cards">
          ${initialExtraDeck.map((card) => extraDeckCard(card, local.extraDeck)).join("")}
        </div>
      </aside>

      <section class="board-readout board-opponent" aria-label="Player 2 board">
        ${boardZoneMarkup(state, AI, {
          selectedAttackers,
          fusionPending: hasPendingFusion(AI),
        })}
        <div class="land-readout">${landPips(playerTwo.lands)} <span>${playerTwo.hand.length} cards</span></div>
      </section>

      <section class="board-readout board-player" aria-label="Player 1 board">
        ${boardZoneMarkup(state, HUMAN, {
          selectedAttackers,
          fusionPending: hasPendingFusion(HUMAN),
        })}
        <div class="land-readout">${landPips(playerOne.lands)} <span>${playerOne.deck.length} deck</span></div>
      </section>

      ${handIsPrivate ? "" : `
        <section class="hand-fan" aria-label="Player ${localId === HUMAN ? 1 : 2} hand">
          ${local.hand.map((card, index) => handCard(card, index, local.hand.length)).join("")}
        </section>
      `}

      <section class="action-dock">
        <p class="notice${shouldSkipEmptyCombat() ? " is-empty-combat" : ""}" role="status">${handIsPrivate ? "Pass the device to continue." : notice}</p>
        ${handIsPrivate ? "" : phaseActions(local)}
      </section>

      ${!handIsPrivate && state.phase === "mulligan" && local.mulliganDecision === "pending" ? mulliganPrompt(local.hand) : ""}
      ${!handIsPrivate && showFusionPrompt ? fusionPrompt(fusionOptions) : ""}
      ${!handIsPrivate && upgradeOptions.length > 0 ? upgradePrompt(upgradeOptions) : ""}
      ${!handIsPrivate && pendingTarget ? targetingPrompt(pendingTarget) : ""}
      ${!handIsPrivate && state.responsePlayer === localId ? responsePrompt(state) : ""}
      ${!handIsPrivate && pendingAttack && pendingAttack.defendingPlayer === localId ? blockerPrompt(pendingAttack, local.monsters) : ""}
      ${!handIsPrivate && state.result && !options.onComplete ? resultPrompt(state) : ""}
      ${privacyCurtainMarkup(privacyCurtain)}
    `;

    if (state.result && options.onComplete && !completionReported) {
      completionReported = true;
      options.onComplete(state.result);
    }
  }

  function syncMatchSfx(): void {
    const phase = `${state.turnNumber}:${state.phase}`;
    if (phase !== audioPhase) {
      audioPhase = phase;
      options.sfx?.play("phase-change");
    }

    for (const playerId of [HUMAN, AI] as const) {
      const life = getPlayer(state, playerId).life;
      const damage = Math.max(0, audibleLife[playerId] - life);
      if (damage > 0) {
        options.sfx?.playLpTicks(damage);
      }
      audibleLife[playerId] = life;
    }

    options.sfx?.setAmbientMonsterCount(allMonsters(state).length);
    if (state.result && !resultSfxPlayed) {
      resultSfxPlayed = true;
      const effect = mode === "ai" && state.result.winner !== HUMAN
        ? "defeat"
        : "victory";
      options.sfx?.play(effect);
    }
  }

  function handCard(card: GameCard, index: number, count: number): string {
    const midpoint = (count - 1) / 2;
    const offset = index - midpoint;
    const playable = isCardPlayable(card) ? " is-playable" : "";
    return `
      <button
        class="hand-card${playable}"
        data-action="play-card"
        data-card-id="${card.instanceId}"
        style="--fan-index:${offset}; --fan-total:${count}"
        aria-label="Play ${card.name}"
      >
        <img src="${cardArt(card)}" alt="${card.name} card art" />
        <span class="card-name">${card.name}</span>
        ${cardStats(card)}
      </button>
    `;
  }

  function hasPendingFusion(playerId: PlayerId): boolean {
    return state.stack.some(
      (item) => item.kind === "fusion" && item.controller === playerId,
    );
  }

  function phaseActions(player: MatchState["players"][number]): string {
    if (state.result || state.phase === "mulligan" || state.responsePlayer) {
      return "";
    }
    if (state.activePlayer !== player.id) {
      return mode === "ai"
        ? '<button class="primary-action" disabled>AI THINKING</button>'
        : "";
    }
    switch (state.phase) {
      case "draw":
        return '<button class="primary-action" data-action="advance">BEGIN MAIN PHASE</button>';
      case "main":
        return '<button class="primary-action" data-action="advance">TO COMBAT</button>';
      case "combat":
        if (!hasReadyAttackers(state, player.id)) {
          return "";
        }
        return `
          <button class="primary-action" data-action="attack">ATTACK${selectedAttackers.size ? ` (${selectedAttackers.size})` : " ALL"}</button>
          <button class="quiet-action" data-action="hold">HOLD</button>
        `;
      case "end": {
        const excess = Math.max(0, player.hand.length - 7);
        return `<button class="primary-action" data-action="advance">${excess ? `DISCARD ${excess} & ` : ""}END TURN</button>`;
      }
    }
  }

  function mulliganPrompt(hand: readonly GameCard[]): string {
    return `
      <div class="decision-backdrop">
        <section class="decision-panel mulligan-panel" data-testid="mulligan-prompt">
          <span class="eyebrow">OPENING HAND</span>
          <h1>Keep these four?</h1>
          <div class="mulligan-cards">
            ${hand.map((card) => `<img src="${cardArt(card)}" alt="${card.name}" />`).join("")}
          </div>
          <div class="decision-actions">
            <button class="primary-action" data-action="keep">KEEP</button>
            <button class="quiet-action" data-action="mulligan">MULLIGAN ONCE</button>
          </div>
        </section>
      </div>
    `;
  }

  function fusionPrompt(options: readonly FusionOption[]): string {
    const player = getPlayer(state, localPlayerId());
    return `
      <section class="floating-prompt fusion-prompt" data-testid="fusion-prompt">
        <span class="eyebrow">FUSION AVAILABLE</span>
        <h2>Fuse?</h2>
        <div class="prompt-options">
          ${options
            .map((option) => {
              const names = option.parentIds
                .map((id) => player.monsters.find((monster) => monster.card.instanceId === id)?.card.name)
                .join(" + ");
              return `<button data-action="fuse" data-parent-a="${option.parentIds[0]}" data-parent-b="${option.parentIds[1]}"><strong>${option.fusionName}</strong><small>${names}</small></button>`;
            })
            .join("")}
        </div>
        <button class="text-action" data-action="dismiss-fusion" data-fusion-key="${options.map((option) => option.parentIds.join("+")).join("|")}">NOT NOW</button>
      </section>
    `;
  }

  function upgradePrompt(options: readonly FusionUpgradeOption[]): string {
    return `
      <section class="floating-prompt upgrade-prompt" data-testid="upgrade-prompt">
        <span class="eyebrow">POWER AVAILABLE</span>
        <h2>Upgrade to ★3?</h2>
        <div class="prompt-options">
          ${options
            .map((option) => `<button data-action="upgrade" data-fusion-id="${option.fusionId}" data-base-id="${option.baseMonsterId}"><strong>${option.fusionName} ★3</strong><small>Absorb ${option.baseMonsterName}</small></button>`)
            .join("")}
        </div>
      </section>
    `;
  }

  function targetingPrompt(target: PendingTarget): string {
    const localId = localPlayerId();
    const otherId = opponentId(localId);
    const local = getPlayer(state, localId);
    const other = getPlayer(state, otherId);
    const playerTargets = target.spellId === "bolt"
      ? `
          <button data-action="target-player" data-player-id="${otherId}">Opponent LP ${other.life}</button>
          <button data-action="target-player" data-player-id="${localId}">Your LP ${local.life}</button>
        `
      : "";
    const monsters = [...other.monsters, ...local.monsters];
    return `
      <section class="floating-prompt targeting-prompt" data-testid="targeting-prompt">
        <span class="eyebrow">${target.spellId.toUpperCase()}</span>
        <h2>Choose a target</h2>
        <div class="prompt-options">
          ${playerTargets}
          ${monsters.map((monster) => `<button data-action="target-monster" data-owner="${ownerOfMonster(state, monster.card.instanceId)}" data-monster-id="${monster.card.instanceId}">${monster.card.name} ${monster.card.attack}/${monster.card.health - monster.damage}</button>`).join("")}
        </div>
        <button class="text-action" data-action="cancel-target">CANCEL</button>
      </section>
    `;
  }

  function responsePrompt(current: MatchState): string {
    const playerId = localPlayerId();
    const top = current.stack.at(-1);
    const counter = findCounterspell(getPlayer(current, playerId).hand);
    const mana = firstReadyElement(current, playerId);
    const canCounter = Boolean(top && counter && mana);
    return `
      <section class="response-prompt" data-testid="response-prompt">
        <span class="response-pulse"></span>
        <div>
          <span class="eyebrow">RESPONSE WINDOW</span>
          <h2>${stackItemLabel(top)}</h2>
          <p>The action is pending. Counter it or let it resolve.</p>
        </div>
        <div class="decision-actions">
          ${canCounter ? '<button class="primary-action" data-action="counter">COUNTERSPELL · 1</button>' : ""}
          <button class="quiet-action" data-action="pass-response">PASS</button>
        </div>
      </section>
    `;
  }

  function blockerPrompt(
    declaration: AttackDeclaration,
    blockers: readonly MonsterPermanent[],
  ): string {
    const attackers = getPlayer(state, declaration.attackingPlayer).monsters.filter((monster) =>
      declaration.attackerIds.includes(monster.card.instanceId),
    );
    return `
      <div class="decision-backdrop">
        <section class="decision-panel blocker-panel" data-testid="blocker-prompt">
          <span class="eyebrow">INCOMING ATTACK</span>
          <h1>Assign blockers</h1>
          <div class="blocker-rows">
            ${attackers.map((attacker) => `
              <label>
                <span><strong>${attacker.card.name}</strong> ${attacker.card.attack}/${attacker.card.health}</span>
                <select data-block-attacker="${attacker.card.instanceId}">
                  <option value="">Take the hit</option>
                  ${blockers.map((blocker) => `<option value="${blocker.card.instanceId}">${blocker.card.name} ${blocker.card.attack}/${blocker.card.health - blocker.damage}</option>`).join("")}
                </select>
              </label>
            `).join("")}
          </div>
          <div class="decision-actions">
            <button class="primary-action" data-action="resolve-blocks">RESOLVE COMBAT</button>
            <button class="quiet-action" data-action="no-blocks">NO BLOCKS</button>
          </div>
        </section>
      </div>
    `;
  }

  function resultPrompt(current: MatchState): string {
    const won = current.result?.winner === localPlayerId();
    const heading = mode === "hotseat"
      ? `Player ${current.result?.winner === HUMAN ? 1 : 2} wins`
      : won ? "Victory" : "Defeat";
    return `
      <div class="decision-backdrop">
        <section class="decision-panel result-panel" data-testid="result-prompt">
          <span class="eyebrow">MATCH COMPLETE</span>
          <h1>${heading}</h1>
          <p>${current.result?.reason === "deck-out" ? "A battler ran out of cards." : "A life counter reached zero."}</p>
          <button class="primary-action" data-action="rematch">REMATCH</button>
          ${mode === "online" ? '<button class="quiet-action" data-action="leave-match">LEAVE MATCH</button>' : ""}
        </section>
      </div>
    `;
  }

  function isCardPlayable(card: GameCard): boolean {
    const playerId = localPlayerId();
    if (
      state.activePlayer !== playerId ||
      state.phase !== "main" ||
      state.responsePlayer ||
      state.result
    ) {
      return false;
    }
    const player = getPlayer(state, playerId);
    if (card.kind === "land") {
      return !player.landPlayedThisTurn;
    }
    if (card.kind === "monster") {
      return (
        card.category === "base-monster" &&
        player.monsters.length < 3 &&
        player.lands.some(
          (land) => land.ready && land.card.element === card.element,
        )
      );
    }
    return card.id !== "counterspell" && Boolean(firstReadyElement(state, playerId));
  }

  function availableFusions(playerId: PlayerId): readonly FusionOption[] {
    if (
      state.phase !== "main" ||
      state.activePlayer !== playerId ||
      state.responsePlayer ||
      state.result
    ) {
      return [];
    }
    return findFusionOptions(state, playerId);
  }

  function availableUpgrades(playerId: PlayerId): readonly FusionUpgradeOption[] {
    if (
      state.phase !== "main" ||
      state.activePlayer !== playerId ||
      state.responsePlayer ||
      state.result
    ) {
      return [];
    }
    const monsters = getPlayer(state, playerId).monsters;
    const options: FusionUpgradeOption[] = [];
    for (const fusion of monsters) {
      const fusionCard = fusion.card;
      if (fusionCard.category !== "fusion-monster" || fusionCard.level === 3) {
        continue;
      }
      for (const base of monsters) {
        const baseCard = base.card;
        if (
          baseCard.category === "base-monster" &&
          fusionCard.elements.includes(baseCard.element)
        ) {
          options.push({
            fusionId: fusionCard.instanceId,
            fusionName: fusionCard.name,
            baseMonsterId: baseCard.instanceId,
            baseMonsterName: baseCard.name,
          });
        }
      }
    }
    return options;
  }

  function playCard(cardId: string): void {
    const playerId = localPlayerId();
    const card = getPlayer(state, playerId).hand.find(
      (candidate) => candidate.instanceId === cardId,
    );
    if (!card) {
      return;
    }
    if (online) {
      if (card.kind === "land") {
        sendOnlineIntent({ kind: "play-land", cardId }, `${card.name} sent to the server.`);
        return;
      }
      if (card.kind === "monster") {
        sendOnlineIntent({ kind: "summon", cardId }, `${card.name} sent to the server.`);
        return;
      }
      if (card.id === "counterspell") {
        notice = "Counterspell can only be played in a response window.";
        render();
        return;
      }
      if (card.id === "draw") {
        castLocalSpell(card, null);
        return;
      }
      pendingTarget = { cardId, spellId: card.id };
      notice = `Choose a target for ${card.name}.`;
      render();
      return;
    }
    try {
      if (card.kind === "land") {
        applyState(playLand(state, playerId, cardId), `${card.name} entered ready.`);
        return;
      }
      if (card.kind === "monster") {
        const next = summonMonster(state, playerId, cardId);
        applyState(next, `${card.name} waits on the stack.`);
        scheduleAi();
        return;
      }
      if (card.id === "counterspell") {
        notice = "Counterspell can only be played in a response window.";
        render();
        return;
      }
      if (card.id === "draw") {
        castLocalSpell(card, null);
        return;
      }
      pendingTarget = { cardId, spellId: card.id };
      notice = `Choose a target for ${card.name}.`;
      render();
    } catch (error) {
      showError(error);
    }
  }

  function castLocalSpell(card: SpellCard, target: SpellTarget | null): void {
    const playerId = localPlayerId();
    const payWith = firstReadyElement(state, playerId);
    if (!payWith) {
      notice = "You need one unused land to cast that spell.";
      render();
      return;
    }
    if (sendOnlineIntent(
      { kind: "cast-spell", cardId: card.instanceId, target, payWith },
      `${card.name} sent to the server.`,
    )) {
      pendingTarget = null;
      return;
    }
    try {
      pendingTarget = null;
      applyState(
        castSpell(state, playerId, card.instanceId, target, payWith),
        `${card.name} waits on the stack.`,
      );
      scheduleAi();
    } catch (error) {
      showError(error);
    }
  }

  function applyState(next: MatchState, message: string): void {
    const before = state;
    state = next;
    notice = shouldSkipEmptyCombat() ? "No attack..." : message;
    syncScene(before, next);
    privacyTransition(before, next);
    render();
    scheduleEmptyCombatSkip();
  }

  function sendOnlineIntent(intent: MatchIntent, message: string): boolean {
    if (!online) {
      return false;
    }
    online.sendIntent(intent);
    notice = message;
    render();
    return true;
  }

  function applyOnlineUpdate(update: OnlineMatchUpdate): void {
    if (disposed) {
      return;
    }
    if (update.state) {
      const before = state;
      const oldStack = [...state.stack];
      state = update.state;
      pendingAttack = update.combat ?? null;
      if (oldStack.length > 0 && state.stack.length === 0) {
        animateStackResolution(oldStack, state);
      } else {
        syncScene(before, state);
      }
    }
    if (update.notice) {
      notice = update.notice;
    }
    render();
  }

  function shouldSkipEmptyCombat(): boolean {
    return state.phase === "combat" && !state.responsePlayer &&
      !hasReadyAttackers(state, state.activePlayer);
  }

  function scheduleEmptyCombatSkip(): void {
    if (online) {
      return;
    }
    window.clearTimeout(emptyCombatTimer);
    emptyCombatTimer = undefined;
    if (!shouldSkipEmptyCombat()) {
      return;
    }
    const playerId = state.activePlayer;
    emptyCombatTimer = window.setTimeout(() => {
      emptyCombatTimer = undefined;
      if (disposed || state.activePlayer !== playerId || !shouldSkipEmptyCombat()) {
        return;
      }
      try {
        applyState(advancePhase(state), "Phase advanced.");
        scheduleAi();
      } catch (error) {
        showError(error);
      }
    }, EMPTY_COMBAT_DELAY_MS);
  }

  function resolveResponse(playerId: PlayerId): void {
    if (sendOnlineIntent({ kind: "pass-response" }, "Pass sent to the server.")) {
      return;
    }
    const before = state;
    const stack = [...state.stack];
    try {
      state = passResponse(state, playerId);
      animateStackResolution(stack, state);
      syncScene(before, state);
      notice = "The stack resolved.";
      privacyTransition(before, state);
      render();
      scheduleAi();
    } catch (error) {
      showError(error);
    }
  }

  function scheduleAi(): void {
    if (mode !== "ai" || disposed || state.result || state.phase === "mulligan") {
      return;
    }
    if (state.responsePlayer !== AI && state.activePlayer !== AI) {
      return;
    }
    window.clearTimeout(aiTimer);
    aiTimer = window.setTimeout(driveAi, 360);
  }

  function driveAi(): void {
    if (disposed) {
      return;
    }
    const before = state;
    const oldStack = [...state.stack];
    const result = runAiTurn(state, AI, { stopAtEmptyCombat: true });
    registerAiFusionActions(result.actions, result.state);
    state = result.state;

    if (oldStack.length > 0 && result.actions.some((action) => action.kind === "pass-response")) {
      animateStackResolution(oldStack, state);
    }
    animateAiImmediateActions(before, result.actions);
    syncScene(before, state);

    if (result.attackDeclaration) {
      pendingAttack = result.attackDeclaration;
      notice = "The AI declared attackers. Choose your blocks.";
    } else if (result.waitingFor === "empty-combat") {
      notice = "No attack...";
    } else if (result.waitingFor === "opponent-response") {
      notice = "You have priority. Counter the pending action or pass.";
    } else if (result.waitingFor === "turn-complete") {
      notice = "Your turn. Advance from draw to begin.";
    } else {
      notice = aiActionSummary(result.actions);
    }
    render();
    scheduleEmptyCombatSkip();
  }

  function registerAiFusionActions(
    actions: readonly AiAction[],
    nextState: MatchState,
  ): void {
    const fusionAction = actions.find(
      (action): action is Extract<AiAction, { kind: "fuse" }> =>
        action.kind === "fuse",
    );
    const pendingFusion = nextState.stack.find((item) => item.kind === "fusion");
    if (fusionAction && pendingFusion) {
      pendingFusionSources.set(pendingFusion.stackId, fusionAction.parentIds);
      fusionAction.parentIds.forEach((id) => retainedSceneIds.add(id));
    }
  }

  function animateAiImmediateActions(
    before: MatchState,
    actions: readonly AiAction[],
  ): void {
    for (const action of actions) {
      if (action.kind === "upgrade-fusion") {
        animateUpgrade(before, action.fusionId, action.baseMonsterId);
      }
    }
  }

  function animateUpgrade(
    before: MatchState,
    fusionId: string,
    baseMonsterId: string,
  ): void {
    if (!arena.getMonster(fusionId) || !arena.getMonster(baseMonsterId)) {
      return;
    }
    retainedSceneIds.add(baseMonsterId);
    arena.releaseMonsterZone(baseMonsterId);
    arena.dispatchAnimation({
      type: "fusion",
      sourceIds: [baseMonsterId, baseMonsterId],
      resultId: fusionId,
      variant: "star3",
    });
    const fusion = findMonster(before, fusionId);
    if (fusion?.card.category === "fusion-monster" && fusion.card.keyword === "burst") {
      arena.dispatchAnimation({
        type: "burst",
        source: { kind: "monster", monsterId: fusionId },
        target: { kind: "side", side: sideFor(opponentOfPlayer(fusionId, before)) },
      });
    }
    scheduleSceneCleanup(() => removeRetained(baseMonsterId), 1450);
  }

  function animateStackResolution(
    stack: readonly PendingStackItem[],
    resolvedState: MatchState,
  ): void {
    const outcome = resolveStackEvents(stack);
    for (const item of outcome.resolved) {
      if (item.kind === "fusion") {
        const sources = pendingFusionSources.get(item.stackId);
        if (sources && sources.every((id) => arena.getMonster(id))) {
          const resultObject = createMonsterModel(item.card.name as AssignedMonsterId);
          arena.stageFusion(sources, item.card.instanceId, resultObject);
          sceneIds.add(item.card.instanceId);
          arena.dispatchAnimation({
            type: "fusion",
            sourceIds: sources,
            resultId: item.card.instanceId,
          });
          if (item.card.keyword === "burst") {
            arena.dispatchAnimation({
              type: "burst",
              source: { kind: "monster", monsterId: item.card.instanceId },
              target: { kind: "side", side: sideFor(opponentId(item.controller)) },
            });
          }
          scheduleSceneCleanup(() => {
            removeRetained(sources[0]);
            removeRetained(sources[1]);
          }, 2450);
        }
        pendingFusionSources.delete(item.stackId);
        continue;
      }
      if (item.kind === "spell") {
        animateSpell(item, stack);
      }
    }

    for (const item of outcome.countered) {
      if (item.kind === "fusion") {
        const sources = pendingFusionSources.get(item.stackId);
        sources?.forEach((id) => {
          retainedSceneIds.delete(id);
          retireMonster(id, false);
        });
        pendingFusionSources.delete(item.stackId);
      }
    }

    syncScene(state, resolvedState);
  }

  function animateSpell(
    item: Extract<PendingStackItem, { kind: "spell" }>,
    stack: readonly PendingStackItem[],
  ): void {
    const source: AnimationAnchor = {
      kind: "side",
      side: sideFor(item.controller),
    };
    if (item.card.id === "counterspell") {
      const targetItem = stack.find(
        (candidate) => candidate.stackId === item.targetStackId,
      );
      arena.dispatchAnimation({
        type: "spell",
        spell: "counterspell",
        source,
        target: targetItem ? anchorForStackItem(targetItem) : source,
      });
      return;
    }
    arena.dispatchAnimation({
      type: "spell",
      spell: item.card.id,
      source,
      target: item.target ? anchorForTarget(item.target) : undefined,
    });
  }

  function syncScene(before: MatchState, after: MatchState): void {
    const nextMonsters = allMonsters(after);
    const nextIds = new Set(nextMonsters.map((entry) => entry.monster.card.instanceId));

    for (const id of [...sceneIds]) {
      if (!nextIds.has(id) && !retainedSceneIds.has(id)) {
        retireMonster(id, wasMonsterDestroyed(before, after, id));
      }
    }

    for (const entry of nextMonsters) {
      const id = entry.monster.card.instanceId;
      if (sceneIds.has(id)) {
        continue;
      }
      const slot = firstOpenSlot(entry.side);
      if (slot === null) {
        continue;
      }
      arena.placeMonster(
        id,
        { side: entry.side, slot },
        createMonsterModel(entry.monster.card.name as AssignedMonsterId),
      );
      sceneIds.add(id);
      arena.dispatchAnimation({ type: "summon", monsterId: id });
    }
  }

  function retireMonster(monsterId: string, animateDeath: boolean): void {
    if (!arena.getMonster(monsterId)) {
      sceneIds.delete(monsterId);
      return;
    }
    arena.releaseMonsterZone(monsterId);
    if (animateDeath) {
      arena.dispatchAnimation({ type: "death", monsterId });
      scheduleSceneCleanup(() => {
        arena.removeMonster(monsterId);
        sceneIds.delete(monsterId);
      }, 950);
      return;
    }
    arena.removeMonster(monsterId);
    sceneIds.delete(monsterId);
  }

  function firstOpenSlot(side: "player" | "opponent"): 0 | 1 | 2 | null {
    for (const slot of [0, 1, 2] as const) {
      if (!arena.getMonsterAt({ side, slot })) {
        return slot;
      }
    }
    return null;
  }

  function removeRetained(monsterId: string): void {
    retainedSceneIds.delete(monsterId);
    arena.removeMonster(monsterId);
    sceneIds.delete(monsterId);
  }

  function scheduleSceneCleanup(cleanup: () => void, delay: number): void {
    const timer = window.setTimeout(() => {
      animationTimers.delete(timer);
      cleanup();
    }, delay);
    animationTimers.add(timer);
  }

  function clearAnimationTimers(): void {
    for (const timer of animationTimers) {
      window.clearTimeout(timer);
    }
    animationTimers.clear();
  }

  function resolveLocalAttack(): void {
    const attackerId = localPlayerId();
    const defenderId = opponentId(attackerId);
    const eligible = getPlayer(state, attackerId).monsters.filter(
      (monster) => !hasSummoningSickness(state, monster),
    );
    const attackerIds = selectedAttackers.size
      ? [...selectedAttackers]
      : eligible.map((monster) => monster.card.instanceId);
    if (attackerIds.length === 0) {
      notice = "No ready monsters can attack.";
      render();
      return;
    }
    if (sendOnlineIntent(
      { kind: "declare-attackers", attackerIds },
      "Attack declaration sent to the server.",
    )) {
      selectedAttackers.clear();
      return;
    }
    try {
      const declaration = declareAttackers(state, attackerId, attackerIds);
      if (mode === "hotseat") {
        pendingAttack = declaration;
        notice = `Player ${defenderId === HUMAN ? 1 : 2}, assign blockers.`;
        showPrivacyCurtain(defenderId, "turn");
        render();
        return;
      }
      const blockers = getPlayer(state, defenderId).monsters.slice(0, attackerIds.length);
      const blocks = blockers.map((blocker, index): BlockAssignment => ({
        attackerId: attackerIds[index],
        blockerId: blocker.card.instanceId,
      }));
      const plan = assignBlockers(state, defenderId, declaration, blocks);
      resolveCombatPlan(plan);
      selectedAttackers = new Set();
    } catch (error) {
      showError(error);
    }
  }

  function resolveBlocks(useSelections: boolean): void {
    if (!pendingAttack) {
      return;
    }
    const blocks: BlockAssignment[] = [];
    if (useSelections) {
      const seen = new Set<string>();
      for (const select of hud.querySelectorAll<HTMLSelectElement>("[data-block-attacker]")) {
        if (!select.value) {
          continue;
        }
        if (seen.has(select.value)) {
          notice = "Each monster can block only one attacker.";
          render();
          return;
        }
        seen.add(select.value);
        blocks.push({
          attackerId: select.dataset.blockAttacker ?? "",
          blockerId: select.value,
        });
      }
    }
    if (sendOnlineIntent(
      { kind: "assign-blockers", blocks },
      "Blocks sent to the server.",
    )) {
      return;
    }
    try {
      const defenderId = localPlayerId();
      const plan = assignBlockers(state, defenderId, pendingAttack, blocks);
      pendingAttack = null;
      resolveCombatPlan(plan, mode !== "hotseat");
      if (mode === "hotseat") {
        showPrivacyCurtain(state.activePlayer, "turn");
        render();
      } else {
        scheduleAi();
      }
    } catch (error) {
      showError(error);
    }
  }

  function resolveCombatPlan(plan: CombatPlan, shouldRender = true): void {
    const before = state;
    animateCombat(plan);
    state = resolveCombat(state, plan);
    syncScene(before, state);
    notice = "Combat resolved.";
    if (shouldRender) {
      render();
    }
  }

  function animateCombat(plan: CombatPlan): void {
    const blockers = new Map(
      plan.blocks.map((block) => [block.attackerId, block.blockerId]),
    );
    for (const attackerId of plan.attackerIds) {
      const blockerId = blockers.get(attackerId);
      const target: AnimationAnchor = blockerId && arena.getMonster(blockerId)
        ? { kind: "monster", monsterId: blockerId }
        : { kind: "side", side: sideFor(plan.defendingPlayer) };
      arena.dispatchAnimation({ type: "attack", attackerId, target });
      if (blockerId && arena.getMonster(blockerId)) {
        arena.dispatchAnimation({
          type: "hit",
          monsterId: blockerId,
          from: { kind: "monster", monsterId: attackerId },
        });
        arena.dispatchAnimation({
          type: "hit",
          monsterId: attackerId,
          from: { kind: "monster", monsterId: blockerId },
        });
      }
    }
  }

  function advanceLocalPhase(): void {
    const playerId = localPlayerId();
    if (online) {
      const player = getPlayer(state, playerId);
      const excess = state.phase === "end" ? Math.max(0, player.hand.length - 7) : 0;
      if (excess > 0) {
        sendOnlineIntent(
          { kind: "discard", cardIds: player.hand.slice(0, excess).map((card) => card.instanceId) },
          "Discard sent to the server.",
        );
      } else {
        sendOnlineIntent({ kind: "advance-phase" }, "Phase change sent to the server.");
      }
      return;
    }
    try {
      if (state.phase === "end") {
        const player = getPlayer(state, playerId);
        const excess = Math.max(0, player.hand.length - 7);
        if (excess > 0) {
          state = discardToHandLimit(
            state,
            playerId,
            player.hand.slice(0, excess).map((card) => card.instanceId),
          );
        }
      }
      applyState(advancePhase(state), "Phase advanced.");
      scheduleAi();
    } catch (error) {
      showError(error);
    }
  }

  function counterPendingAction(): void {
    const playerId = localPlayerId();
    const card = findCounterspell(getPlayer(state, playerId).hand);
    const payWith = firstReadyElement(state, playerId);
    const target = state.stack.at(-1);
    if (!card || !payWith || !target) {
      return;
    }
    if (sendOnlineIntent(
      { kind: "counterspell", cardId: card.instanceId, targetStackId: target.stackId, payWith },
      "Counterspell sent to the server.",
    )) {
      return;
    }
    try {
      applyState(
        castCounterspell(
          state,
          playerId,
          card.instanceId,
          target.stackId,
          payWith,
        ),
        "Counterspell added to the stack.",
      );
      scheduleAi();
    } catch (error) {
      showError(error);
    }
  }

  function selectBoardCard(button: HTMLElement): void {
    const monsterId = button.dataset.monsterId;
    const owner = button.dataset.owner as PlayerId | undefined;
    if (!monsterId || !owner) {
      return;
    }
    if (pendingTarget) {
      castTargetedMonster(owner, monsterId);
      return;
    }
    if (
      state.activePlayer === localPlayerId() &&
      state.phase === "combat" &&
      owner === localPlayerId()
    ) {
      const monster = getPlayer(state, localPlayerId()).monsters.find(
        (candidate) => candidate.card.instanceId === monsterId,
      );
      if (!monster || hasSummoningSickness(state, monster)) {
        notice = "That monster still has summoning sickness.";
      } else if (selectedAttackers.has(monsterId)) {
        selectedAttackers.delete(monsterId);
      } else {
        selectedAttackers.add(monsterId);
      }
      render();
    }
  }

  function castTargetedMonster(owner: PlayerId, monsterId: string): void {
    if (!pendingTarget) {
      return;
    }
    const card = findSpellByInstance(pendingTarget.cardId);
    if (card) {
      castLocalSpell(card, { kind: "monster", playerId: owner, monsterId });
    }
  }

  function findSpellByInstance(cardId: string): SpellCard | null {
    const card = getPlayer(state, localPlayerId()).hand.find(
      (candidate) => candidate.instanceId === cardId,
    );
    return card?.kind === "spell" ? card : null;
  }

  function chooseMulligan(choice: "keep" | "mulligan"): void {
    if (sendOnlineIntent(
      { kind: choice === "keep" ? "keep-hand" : "mulligan" },
      choice === "keep" ? "Keep sent to the server." : "Mulligan sent to the server.",
    )) {
      return;
    }
    const before = state;
    const playerId = localPlayerId();
    if (choice === "keep") {
      state = keepHand(state, playerId);
    } else {
      const player = getPlayer(state, playerId);
      const fullDeck = [...player.hand, ...player.deck];
      const rotated = [...fullDeck.slice(5), ...fullDeck.slice(0, 5)];
      state = takeMulligan(state, playerId, rotated);
    }

    if (
      mode === "ai" &&
      getPlayer(state, AI).mulliganDecision === "pending"
    ) {
      state = keepHand(state, AI);
    }

    notice = choice === "keep"
      ? "Opening hand kept."
      : "Mulligan complete.";
    syncScene(before, state);

    if (mode === "hotseat") {
      const pendingPlayer = state.players.find(
        (player) => player.mulliganDecision === "pending",
      );
      showPrivacyCurtain(pendingPlayer?.id ?? state.activePlayer, "turn");
    }
    render();
  }

  function handleClick(event: Event): void {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLElement>("[data-action]");
    if (!button) {
      return;
    }
    const action = button.dataset.action;
    if (action === "acknowledge-curtain") {
      privacyCurtain = null;
      notice = state.responsePlayer
        ? "Counter the pending action or pass."
        : state.phase === "mulligan"
          ? "Choose Keep or Mulligan to begin."
          : `Player ${localPlayerId() === HUMAN ? 1 : 2}'s turn.`;
      render();
      return;
    }
    if (privacyCurtain) {
      return;
    }
    switch (action) {
      case "keep":
        chooseMulligan("keep");
        return;
      case "mulligan":
        chooseMulligan("mulligan");
        return;
      case "play-card":
        playCard(button.dataset.cardId ?? "");
        return;
      case "advance":
        advanceLocalPhase();
        return;
      case "hold":
        selectedAttackers.clear();
        if (sendOnlineIntent({ kind: "hold-attack" }, "Hold sent to the server.")) {
          return;
        }
        advanceLocalPhase();
        return;
      case "attack":
        resolveLocalAttack();
        return;
      case "board-card":
        selectBoardCard(button);
        return;
      case "fuse": {
        const first = button.dataset.parentA;
        const second = button.dataset.parentB;
        if (!first || !second) {
          return;
        }
        if (online) {
          const pending = state.stack.find((item) => item.kind === "fusion");
          if (pending) {
            pendingFusionSources.set(pending.stackId, [first, second]);
          }
          sendOnlineIntent({ kind: "fuse", parentIds: [first, second] }, "Fusion sent to the server.");
          return;
        }
        try {
          const next = fuseMonsters(state, localPlayerId(), [first, second]);
          const pending = next.stack.find((item) => item.kind === "fusion");
          if (pending) {
            pendingFusionSources.set(pending.stackId, [first, second]);
            retainedSceneIds.add(first);
            retainedSceneIds.add(second);
          }
          applyState(next, "Fusion summon waits on the stack.");
          scheduleAi();
        } catch (error) {
          showError(error);
        }
        return;
      }
      case "dismiss-fusion":
        dismissedFusionKey = button.dataset.fusionKey ?? "";
        render();
        return;
      case "upgrade": {
        const fusionId = button.dataset.fusionId;
        const baseId = button.dataset.baseId;
        if (!fusionId || !baseId) {
          return;
        }
        if (sendOnlineIntent(
          { kind: "upgrade-fusion", fusionCardId: fusionId, baseMonsterCardId: baseId },
          "Fusion upgrade sent to the server.",
        )) {
          return;
        }
        try {
          const before = state;
          state = upgradeFusion(state, localPlayerId(), fusionId, baseId);
          animateUpgrade(before, fusionId, baseId);
          syncScene(before, state);
          notice = "Fusion upgraded to ★3.";
          render();
        } catch (error) {
          showError(error);
        }
        return;
      }
      case "target-player": {
        const playerId = button.dataset.playerId as PlayerId | undefined;
        const card = pendingTarget ? findSpellByInstance(pendingTarget.cardId) : null;
        if (playerId && card) {
          castLocalSpell(card, { kind: "player", playerId });
        }
        return;
      }
      case "target-monster": {
        const owner = button.dataset.owner as PlayerId | undefined;
        const monsterId = button.dataset.monsterId;
        if (owner && monsterId) {
          castTargetedMonster(owner, monsterId);
        }
        return;
      }
      case "cancel-target":
        pendingTarget = null;
        notice = "Spell targeting canceled.";
        render();
        return;
      case "counter":
        counterPendingAction();
        return;
      case "pass-response":
        resolveResponse(localPlayerId());
        return;
      case "resolve-blocks":
        resolveBlocks(true);
        return;
      case "no-blocks":
        resolveBlocks(false);
        return;
      case "rematch":
        if (online) {
          online.requestRematch();
          notice = "Rematch request sent. Waiting for your opponent.";
          render();
          return;
        }
        clearAnimationTimers();
        for (const id of [...sceneIds]) {
          arena.removeMonster(id);
        }
        sceneIds.clear();
        retainedSceneIds.clear();
        pendingFusionSources.clear();
        selectedAttackers.clear();
        pendingTarget = null;
        pendingAttack = null;
        dismissedFusionKey = "";
        state = newMatch();
        completionReported = false;
        resultSfxPlayed = false;
        audioPhase = `${state.turnNumber}:${state.phase}`;
        audibleLife[HUMAN] = getPlayer(state, HUMAN).life;
        audibleLife[AI] = getPlayer(state, AI).life;
        viewingPlayer = HUMAN;
        privacyCurtain = mode === "hotseat"
          ? { playerId: HUMAN, reason: "turn" }
          : null;
        notice = "Choose Keep or Mulligan to begin.";
        if (mode === "hotseat") {
          options.sfx?.play("curtain");
        }
        render();
        return;
      case "leave-match":
        if (online) {
          online.leaveMatch();
        }
        return;
    }
  }

  function showError(error: unknown): void {
    notice = error instanceof Error ? error.message : "That action is not legal.";
    render();
  }

  unsubscribeOnline = online?.subscribe(applyOnlineUpdate) ?? (() => {});
  hud.addEventListener("click", handleClick);
  render();

  return {
    getState: () => state,
    dispose() {
      disposed = true;
      window.clearTimeout(aiTimer);
      window.clearTimeout(emptyCombatTimer);
      clearAnimationTimers();
      for (const id of [...sceneIds]) {
        arena.removeMonster(id);
      }
      sceneIds.clear();
      retainedSceneIds.clear();
      pendingFusionSources.clear();
      unsubscribeOnline();
      options.sfx?.setAmbientMonsterCount(0);
      hud.removeEventListener("click", handleClick);
      hud.remove();
      art.dispose();
    },
  };

  function cardArt(card: GameCard): string {
    if (card.kind === "land") {
      return landArt(card.element, card.name);
    }
    const artId = card.name as CardArtId;
    return CARD_ART_IDS.includes(artId) ? art.render(artId) : landArt("water", card.name);
  }

  function extraDeckCard(
    card: FusionMonsterCard,
    remaining: readonly FusionMonsterCard[],
  ): string {
    const available = remaining.some(
      (candidate) => candidate.instanceId === card.instanceId,
    );
    return `
      <article class="extra-card${available ? "" : " is-spent"}">
        <img src="${cardArt(card)}" alt="${card.name}" />
        <span>${card.name}</span>
        <small>${card.attack}/${card.health} ${available ? "READY" : "SUMMONED"}</small>
      </article>
    `;
  }
}

export function mountVsAiMatch(
  root: HTMLElement,
  arena: ArenaScene,
): MatchController {
  return mountMatch(root, arena, { mode: "ai" });
}

function playableDeck(archetype: ArchetypeId): readonly GameCard[] {
  const deck = assembleDeck(archetype);
  const lands = deck.filter((card) => card.kind === "land");
  const monsters = deck.filter((card) => card.kind === "monster");
  const spells = deck.filter((card) => card.kind === "spell");
  return [
    lands[0], monsters[0], spells[0], lands[4],
    monsters[4], lands[1], monsters[1], spells[1],
    lands[5], monsters[5], lands[2], monsters[2],
    spells[2], lands[6], monsters[6], lands[3],
    monsters[3], spells[3], lands[7], monsters[7],
  ];
}

function primaryElement(archetypeId: ArchetypeId): Element {
  const archetype = ARCHETYPES.find((candidate) => candidate.id === archetypeId);
  if (!archetype) {
    throw new Error(`Unknown archetype ${archetypeId}`);
  }
  return archetype.elements[0];
}

function cardStats(card: GameCard): string {
  if (card.kind === "land") {
    return `<small class="card-meta">${card.element.toUpperCase()} MANA</small>`;
  }
  if (card.kind === "monster") {
    return `<small class="card-meta">${card.attack} ATK · ${card.health} HP</small>`;
  }
  return `<small class="card-meta">${card.timing.toUpperCase()} · COST 1</small>`;
}

function phaseLabel(state: MatchState): string {
  if (state.phase === "mulligan") {
    return "MULLIGAN";
  }
  return state.phase.toUpperCase();
}

function landPips(lands: MatchState["players"][number]["lands"]): string {
  if (lands.length === 0) {
    return '<span class="no-lands">NO LANDS</span>';
  }
  return lands
    .map((land) => `<i class="land-pip element-${land.card.element}${land.ready ? " is-ready" : ""}" title="${land.card.name} ${land.ready ? "ready" : "spent"}"></i>`)
    .join("");
}

function landArt(element: Element, name: string): string {
  const colors: Record<Element, string> = {
    fire: "#ff5b38",
    water: "#27b9ff",
    earth: "#c78a4b",
    air: "#8fe8d1",
    lightning: "#b994ff",
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="176" height="246"><defs><radialGradient id="g"><stop stop-color="${colors[element]}" stop-opacity=".8"/><stop offset="1" stop-color="#050711"/></radialGradient></defs><rect width="176" height="246" rx="12" fill="url(#g)"/><circle cx="88" cy="105" r="44" fill="none" stroke="${colors[element]}" stroke-width="5"/><path d="M88 64v82M47 105h82" stroke="#fff" stroke-opacity=".55"/><text x="88" y="205" fill="white" font-family="system-ui" font-size="17" font-weight="700" text-anchor="middle">${name}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function firstReadyElement(state: MatchState, playerId: PlayerId): Element | null {
  return getPlayer(state, playerId).lands.find((land) => land.ready)?.card.element ?? null;
}

function hasReadyAttackers(state: MatchState, playerId: PlayerId): boolean {
  return getPlayer(state, playerId).monsters.some(
    (monster) => !hasSummoningSickness(state, monster),
  );
}

function findCounterspell(cards: readonly GameCard[]): SpellCard | null {
  const card = cards.find(
    (candidate): candidate is SpellCard =>
      candidate.kind === "spell" && candidate.id === "counterspell",
  );
  return card ?? null;
}

function stackItemLabel(item: PendingStackItem | undefined): string {
  if (!item) {
    return "Pending action";
  }
  if (item.kind === "summon") {
    return `${item.card.name} summon`;
  }
  if (item.kind === "fusion") {
    return `${item.card.name} fusion summon`;
  }
  return `${item.card.name} spell`;
}

function sideFor(playerId: PlayerId): "player" | "opponent" {
  return playerId === HUMAN ? "player" : "opponent";
}

function opponentId(playerId: PlayerId): PlayerId {
  return playerId === HUMAN ? AI : HUMAN;
}

function anchorForTarget(target: SpellTarget): AnimationAnchor {
  if (target.kind === "player") {
    return { kind: "side", side: sideFor(target.playerId) };
  }
  return { kind: "monster", monsterId: target.monsterId };
}

function anchorForStackItem(item: PendingStackItem): AnimationAnchor {
  if (item.kind === "spell" && item.target) {
    return anchorForTarget(item.target);
  }
  return { kind: "side", side: sideFor(item.controller) };
}

function allMonsters(state: MatchState): readonly {
  monster: MonsterPermanent;
  side: "player" | "opponent";
}[] {
  return [
    ...getPlayer(state, HUMAN).monsters.map((monster) => ({ monster, side: "player" as const })),
    ...getPlayer(state, AI).monsters.map((monster) => ({ monster, side: "opponent" as const })),
  ];
}

function findMonster(state: MatchState, monsterId: string): MonsterPermanent | null {
  return allMonsters(state).find(
    (entry) => entry.monster.card.instanceId === monsterId,
  )?.monster ?? null;
}

function ownerOfMonster(state: MatchState, monsterId: string): PlayerId {
  return getPlayer(state, HUMAN).monsters.some(
    (monster) => monster.card.instanceId === monsterId,
  ) ? HUMAN : AI;
}

function opponentOfPlayer(monsterId: string, state: MatchState): PlayerId {
  return opponentId(ownerOfMonster(state, monsterId));
}

function wasMonsterDestroyed(
  before: MatchState,
  after: MatchState,
  monsterId: string,
): boolean {
  const existed = Boolean(findMonster(before, monsterId));
  const discarded = after.players.some((player) =>
    player.discardPile.some((card) => card.instanceId === monsterId),
  );
  return existed && discarded;
}

function aiActionSummary(actions: readonly AiAction[]): string {
  const last = actions.at(-1);
  if (!last) {
    return "Waiting for the AI.";
  }
  switch (last.kind) {
    case "play-land":
      return "The AI played a land.";
    case "summon":
      return "The AI summoned a monster. You may respond.";
    case "fuse":
      return "The AI started a fusion summon. You may respond.";
    case "upgrade-fusion":
      return "The AI upgraded a fusion to ★3.";
    case "cast-spell":
      return `The AI cast ${last.spellId}.`;
    case "counterspell":
      return "The AI cast Counterspell.";
    case "pass-response":
      return "The AI passed priority.";
    case "attack":
      return "The AI declared attackers.";
    case "hold-attack":
      return "The AI held its attackers.";
    case "discard":
      return "The AI discarded to seven cards.";
    case "advance-phase":
      return "The AI advanced the phase.";
  }
}
