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
  type BaseMonsterCard,
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
import type { DecisionTimer, MatchIntent } from "../server/protocol";
import {
  findFusionOptions,
  fuseMonsters,
  upgradeFusion,
  type FusionOption,
} from "../rules/fusion";
import {
  availableCounterspellResponse,
  castCounterspell,
  castSpell,
  passResponse,
} from "../rules/spells";
import { resolveStackEvents } from "./events";
import {
  DrawAnimationQueue,
  type QueuedDraw,
} from "./draw-animation";
import {
  createFusionRevealOverlay,
  fusionRevealFromEvent,
  upgradeRevealsFromTransition,
  type FusionRevealData,
} from "./fusion-reveal";
import { boardZoneMarkup } from "./board-zone";
import {
  applyCoachMarkTargets,
  coachMarkMarkup,
  createCoachMarkTracker,
} from "./coach-marks";
import { createSummonTipTracker } from "./summon-tip";
import {
  createMonsterTooltip,
  monsterTooltipContent,
} from "../scene/monster-tooltip";
import {
  createSpellTooltip,
  spellTooltipContent,
} from "../scene/spell-tooltip";
import {
  damageOutcome,
  isRecommendedTarget,
  monsterTargetLabel,
  requiresSelfTargetConfirmation,
} from "./targeting";
import {
  privacyCurtainForTransition,
  privacyCurtainMarkup,
  type PrivacyCurtainReason,
  type PrivacyCurtainRequest,
} from "./privacy-curtain";
import {
  installPhaseAdvanceShortcut,
  phaseAdvanceButton,
  responsePassButton,
} from "./phase-advance-shortcut";
import {
  resultMessageFor,
  resultMessageMarkup,
} from "./result-message";
import type { SfxEngine } from "../sfx";

const HUMAN: PlayerId = "player-1";
const AI: PlayerId = "player-2";
const HUMAN_ARCHETYPE: ArchetypeId = "fire-water";
const AI_ARCHETYPE: ArchetypeId = "earth-lightning";
const EMPTY_COMBAT_DELAY_MS = 800;
const SUMMON_TIP_DURATION_MS = 2_000;
const DRAW_ANIMATION_DURATION_MS = 400;
const DRAW_HIGHLIGHT_DURATION_MS = 1_000;
const COACH_MARK_DURATION_MS = 4_000;

interface PendingTarget {
  readonly cardId: string;
  readonly spellId: "bolt" | "destroy";
}

export interface FusionUpgradeOption {
  readonly fusionId: string;
  readonly fusionName: string;
  readonly fusionPortraitId: CardArtId;
  readonly baseMonsterId: string;
  readonly baseMonsterName: string;
  readonly baseMonsterPortraitId: CardArtId;
}

/**
 * Keeps the upgrade prompt tied to the same permanent IDs that the rules and
 * board animation use. The prompt must never infer a different pair by name.
 */
export function createFusionUpgradeOption(
  fusion: FusionMonsterCard,
  baseMonster: BaseMonsterCard,
): FusionUpgradeOption {
  return {
    fusionId: fusion.instanceId,
    fusionName: fusion.name,
    fusionPortraitId: fusion.name as CardArtId,
    baseMonsterId: baseMonster.instanceId,
    baseMonsterName: baseMonster.name,
    baseMonsterPortraitId: baseMonster.name as CardArtId,
  };
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
  readonly timers?: readonly DecisionTimer[];
  readonly fusionDeclined?: boolean;
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
  /**
   * Provides a deterministic local match snapshot for integration tests and
   * playtest tooling. Online matches always use their authoritative adapter.
   */
  readonly initialState?: MatchState;
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
  const arenaCanvas = root.querySelector<HTMLCanvasElement>("canvas");
  const monsterTooltip = createMonsterTooltip(root);
  const spellTooltip = createSpellTooltip(root);
  const drawLayer = document.createElement("div");
  drawLayer.className = "draw-animation-layer";
  drawLayer.setAttribute("aria-hidden", "true");
  root.append(drawLayer);
  const fusionReveal = createFusionRevealOverlay(root, cardArt);

  const initialExtraDecks: Record<PlayerId, readonly FusionMonsterCard[]> = {
    "player-1": deriveExtraDeck(playerOneArchetype),
    "player-2": deriveExtraDeck(playerTwoArchetype),
  };
  let state = online?.getState() ?? options.initialState ?? newMatch();
  let viewingPlayer: PlayerId = HUMAN;
  let privacyCurtain: PrivacyCurtainRequest | null = mode === "hotseat"
    ? { playerId: HUMAN, reason: "turn" }
    : null;
  let selectedAttackers = new Set<string>();
  let pendingTarget: PendingTarget | null = null;
  let targetConfirmation: SpellTarget | null = null;
  let pendingAttack: AttackDeclaration | null = null;
  let dismissedFusionKey = "";
  let notice = "Choose Keep or Mulligan to begin.";
  let aiTimer: number | undefined;
  let emptyCombatTimer: number | undefined;
  let disposed = false;
  let completionReported = false;
  let resultSfxPlayed = false;
  let summonTipVisible = false;
  let summonTipTimer: number | undefined;
  let renderedState = state;
  const drawQueue = new DrawAnimationQueue();
  const highlightedCardIds = new Set<string>();
  const drawHighlightTimers = new Map<string, number>();
  let activeDraw: QueuedDraw | null = null;
  let activeDrawAnimation: Animation | null = null;
  let drawAnimationToken = 0;
  let coachMarkTimer: number | undefined;
  let audioPhase = `${state.turnNumber}:${state.phase}`;
  const audibleLife: Record<PlayerId, number> = {
    "player-1": getPlayer(state, HUMAN).life,
    "player-2": getPlayer(state, AI).life,
  };
  const animationTimers = new Set<number>();
  const sceneIds = new Set<string>();
  const retainedSceneIds = new Set<string>();
  const pendingFusionSources = new Map<string, readonly [string, string]>();
  const pendingFusionReveals = new Map<string, FusionRevealData>();
  const summonTip = createSummonTipTracker();
  const coachMarks = createCoachMarkTracker();
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
    targetConfirmation = null;
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
    hideMonsterTooltip();
    hideSpellTooltip();
    drawQueue.enqueueTransition(renderedState, state);
    renderedState = state;
    syncMatchSfx();
    const playerOne = getPlayer(state, HUMAN);
    const playerTwo = getPlayer(state, AI);
    const localId = localPlayerId();
    const local = getPlayer(state, localId);
    const handIsPrivate = mode === "hotseat" && privacyCurtain !== null;
    const fusionOptions = availableFusions(localId);
    const upgradeOptions = availableUpgrades(localId);
    const initialExtraDeck = initialExtraDecks[localId];
    const previousCoachMark = coachMarks.current();
    const coachMark = mode !== "online" && !handIsPrivate
      ? coachMarks.update(state, localId)
      : null;
    if (coachMark && coachMark !== previousCoachMark) {
      showCoachMark();
    }
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
        <div class="land-readout">${landPips(playerTwo.lands)} <span data-draw-hand="${AI}">${playerTwo.hand.length} cards</span></div>
      </section>

      <section class="board-readout board-player" aria-label="Player 1 board">
        ${boardZoneMarkup(state, HUMAN, {
          selectedAttackers,
          fusionPending: hasPendingFusion(HUMAN),
        })}
        <div class="land-readout">${landPips(playerOne.lands)} <span>${playerOne.deck.length} deck</span></div>
      </section>

      ${drawDeckAnchor(AI, playerTwo.deck.length)}
      ${drawDeckAnchor(HUMAN, playerOne.deck.length)}

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
      ${summonTipVisible ? '<aside class="summon-tip" data-testid="summon-tip" role="status">Lv1 creatures can\'t attack on their first turn.</aside>' : ""}
      ${coachMark ? coachMarkMarkup(coachMark) : ""}
      ${privacyCurtainMarkup(privacyCurtain)}
    `;
    applyCoachMarkTargets(hud, coachMark);

    startNextDrawAnimation();

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
    const highlighted = highlightedCardIds.has(card.instanceId)
      ? " is-newly-drawn"
      : "";
    const spellTooltipId = card.kind === "spell"
      ? ` data-spell-tooltip-id="${card.id}"`
      : "";
    return `
      <button
        class="hand-card${playable}${highlighted}"
        data-action="play-card"
        data-card-id="${card.instanceId}"
        ${spellTooltipId}
        style="--fan-index:${offset}; --fan-total:${count}"
        aria-label="Play ${card.name}"
      >
        <img src="${cardArt(card)}" alt="${card.name} card art" />
        <span class="card-name">${card.name}</span>
        ${cardStats(card)}
      </button>
    `;
  }

  function drawDeckAnchor(playerId: PlayerId, count: number): string {
    return `
      <div class="draw-deck-anchor" data-draw-deck="${playerId}" aria-label="${playerId === HUMAN ? "Your" : "Opponent"} deck">
        <span>${count}</span>
      </div>
    `;
  }

  function startNextDrawAnimation(): void {
    if (disposed || activeDraw || privacyCurtain || drawQueue.length === 0) {
      return;
    }

    const draw = drawQueue.next();
    if (!draw) {
      return;
    }

    const source = hud.querySelector<HTMLElement>(
      `[data-draw-deck="${draw.playerId}"]`,
    );
    const destination = drawDestination(draw);
    if (!source || !destination) {
      startNextDrawAnimation();
      return;
    }

    const sourceBounds = source.getBoundingClientRect();
    const destinationBounds = destination.getBoundingClientRect();
    if (
      sourceBounds.width === 0 || sourceBounds.height === 0 ||
      destinationBounds.width === 0 || destinationBounds.height === 0
    ) {
      startNextDrawAnimation();
      return;
    }

    activeDraw = draw;
    const revealed = draw.playerId === localPlayerId() && draw.card !== null;
    const flightCard = document.createElement("div");
    flightCard.className = `draw-animation-card${revealed ? "" : " is-card-back"}`;
    if (revealed && draw.card) {
      flightCard.innerHTML = `<img src="${cardArt(draw.card)}" alt="" />`;
    }
    drawLayer.append(flightCard);

    const token = ++drawAnimationToken;
    const sourceCenter = centerOf(sourceBounds);
    const destinationCenter = centerOf(destinationBounds);
    const destinationWidth = revealed ? destinationBounds.width : 64;
    const destinationHeight = revealed ? destinationBounds.height : 90;
    const animation = flightCard.animate(
      [
        {
          left: `${sourceCenter.x}px`,
          top: `${sourceCenter.y}px`,
          width: `${sourceBounds.width}px`,
          height: `${sourceBounds.height}px`,
          opacity: 0.35,
          transform: "translate(-50%, -50%) rotate(-8deg)",
        },
        {
          left: `${destinationCenter.x}px`,
          top: `${destinationCenter.y}px`,
          width: `${destinationWidth}px`,
          height: `${destinationHeight}px`,
          opacity: 1,
          transform: "translate(-50%, -50%) rotate(0deg)",
        },
      ],
      {
        duration: DRAW_ANIMATION_DURATION_MS,
        easing: "cubic-bezier(0.2, 0.75, 0.25, 1)",
        fill: "forwards",
      },
    );
    activeDrawAnimation = animation;
    animation.onfinish = () => finishDrawAnimation(draw, flightCard, token);
  }

  function drawDestination(draw: QueuedDraw): HTMLElement | null {
    const isLocalDraw = draw.playerId === localPlayerId();
    if (isLocalDraw && draw.card) {
      return [...hud.querySelectorAll<HTMLElement>("[data-card-id]")].find(
        (card) => card.dataset.cardId === draw.card?.instanceId,
      ) ?? null;
    }

    return hud.querySelector<HTMLElement>(
      `[data-draw-hand="${draw.playerId}"]`,
    ) ?? hud.querySelector<HTMLElement>(".hand-fan");
  }

  function finishDrawAnimation(
    draw: QueuedDraw,
    flightCard: HTMLElement,
    token: number,
  ): void {
    if (disposed || token !== drawAnimationToken || activeDraw !== draw) {
      return;
    }

    activeDrawAnimation = null;
    activeDraw = null;
    flightCard.remove();
    if (draw.playerId === localPlayerId() && draw.card) {
      highlightDrawnCard(draw.card.instanceId);
      render();
      return;
    }
    startNextDrawAnimation();
  }

  function highlightDrawnCard(cardId: string): void {
    highlightedCardIds.add(cardId);
    const priorTimer = drawHighlightTimers.get(cardId);
    if (priorTimer !== undefined) {
      window.clearTimeout(priorTimer);
    }
    const timer = window.setTimeout(() => {
      drawHighlightTimers.delete(cardId);
      highlightedCardIds.delete(cardId);
      if (!disposed) {
        render();
      }
    }, DRAW_HIGHLIGHT_DURATION_MS);
    drawHighlightTimers.set(cardId, timer);
  }

  function interruptDrawAnimations(): void {
    drawQueue.clear();
    drawAnimationToken += 1;
    activeDrawAnimation?.cancel();
    activeDrawAnimation = null;
    activeDraw = null;
    drawLayer.replaceChildren();
    for (const timer of drawHighlightTimers.values()) {
      window.clearTimeout(timer);
    }
    drawHighlightTimers.clear();
    highlightedCardIds.clear();
  }

  function centerOf(bounds: DOMRect): { x: number; y: number } {
    return {
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    };
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
        return phaseAdvanceButton("BEGIN MAIN PHASE");
      case "main":
        return phaseAdvanceButton("TO COMBAT");
      case "combat":
        if (!hasReadyAttackers(state, player.id)) {
          return "";
        }
        if (selectedAttackers.size === 0) {
          return `
            ${phaseAdvanceButton("ATTACK ALL", "attack")}
            <button class="quiet-action" data-action="hold">HOLD</button>
          `;
        }
        return `
          <button class="primary-action" data-action="attack">ATTACK (${selectedAttackers.size})</button>
          <button class="quiet-action" data-action="hold">HOLD</button>
        `;
      case "end": {
        const excess = Math.max(0, player.hand.length - 7);
        return phaseAdvanceButton(`${excess ? `DISCARD ${excess} & ` : ""}END TURN`);
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
        <span class="eyebrow">FUSION UPGRADE</span>
        <h2>Choose a ★3 upgrade</h2>
        <div class="prompt-options">
          ${options
            .map((option) => `
              <button
                class="upgrade-option"
                data-action="upgrade"
                data-fusion-id="${option.fusionId}"
                data-base-id="${option.baseMonsterId}"
                aria-label="Consume ${option.baseMonsterName} to upgrade ${option.fusionName} to level 3"
              >
                <span class="upgrade-route">
                  <figure class="upgrade-monster upgrade-monster-consumed">
                    <img src="${art.render(option.baseMonsterPortraitId)}" alt="${option.baseMonsterName} portrait" />
                    <figcaption>
                      <span>CONSUMED</span>
                      <strong>${option.baseMonsterName}</strong>
                    </figcaption>
                  </figure>
                  <span class="upgrade-merge" aria-hidden="true">
                    <span>+</span>
                    <span>→</span>
                  </span>
                  <figure class="upgrade-monster upgrade-monster-result">
                    <img src="${art.render(option.fusionPortraitId)}" alt="${option.fusionName} portrait" />
                    <figcaption>
                      <span class="upgrade-stars">★★★</span>
                      <strong>${option.fusionName}</strong>
                    </figcaption>
                  </figure>
                </span>
                <span class="upgrade-effect"><strong>${option.baseMonsterName} is consumed.</strong> ${option.fusionName} becomes ★3: +1 ATK and +1 max HP, keeps all damage/HP.</span>
              </button>
            `)
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
    const card = findSpellByInstance(target.cardId);
    if (!card) {
      return "";
    }
    if (targetConfirmation) {
      return `
        <section class="floating-prompt targeting-prompt targeting-confirmation" data-testid="targeting-self-confirm">
          <span class="eyebrow">${card.name.toUpperCase()}</span>
          <h2>Are you sure?</h2>
          <p>This target is yours and is not recommended.</p>
          <div class="decision-actions">
            <button class="primary-action" data-action="confirm-target">CAST ANYWAY</button>
            <button class="quiet-action" data-action="cancel-target-confirm">CANCEL</button>
          </div>
        </section>
      `;
    }
    const damageAmount = card.effect.kind === "damage" ? card.effect.amount : null;
    const targetClass = (targetOwner: PlayerId, isLethal = false): string =>
      [
        "target-option",
        isRecommendedTarget(card.effect, localId, targetOwner)
          ? "is-recommended-target"
          : "",
        isLethal ? "is-lethal-target" : "",
      ].filter(Boolean).join(" ");
    const playerTargets = damageAmount !== null
      ? `
          <button class="${targetClass(otherId)}" data-action="target-player" data-player-id="${otherId}"><span class="target-label">Opponent LP ${other.life} <span class="target-damage-outcome">→ ${damageOutcome(other.life, damageAmount).remaining}</span></span></button>
          <button class="${targetClass(localId)}" data-action="target-player" data-player-id="${localId}"><span class="target-label">Your LP ${local.life} <span class="target-damage-outcome">→ ${damageOutcome(local.life, damageAmount).remaining}</span></span></button>
        `
      : "";
    const monsters = [...other.monsters, ...local.monsters];
    return `
      <section class="floating-prompt targeting-prompt" data-testid="targeting-prompt">
        <span class="eyebrow spell-tooltip-trigger" data-spell-tooltip-id="${card.id}">${target.spellId.toUpperCase()}</span>
        <h2>${damageAmount === null ? "Choose a target" : `${card.name} · deal ${damageAmount} damage`}</h2>
        <div class="prompt-options">
          ${playerTargets}
          ${monsters.map((monster) => {
            const owner = ownerOfMonster(state, monster.card.instanceId);
            const remainingHealth = monster.card.health - monster.damage;
            const outcome = damageAmount === null
              ? null
              : damageOutcome(remainingHealth, damageAmount);
            return `<button class="${targetClass(owner, outcome?.isLethal)}" data-action="target-monster" data-owner="${owner}" data-monster-id="${monster.card.instanceId}">${outcome === null
              ? monsterTargetLabel(monster.card.name, monster.card.attack, remainingHealth, localId, owner)
              : `<span class="target-label">${monsterTargetLabel(monster.card.name, monster.card.attack, remainingHealth, localId, owner)}</span><span class="target-damage-outcome">→ ${outcome.isLethal ? "0 HP" : `SURVIVES AT ${outcome.remaining} HP`}</span>${outcome.isLethal ? '<span class="target-lethal-marker">DESTROYED</span>' : ""}`}</button>`;
          }).join("")}
        </div>
        <button class="text-action" data-action="cancel-target">CANCEL</button>
      </section>
    `;
  }

  function responsePrompt(current: MatchState): string {
    const playerId = localPlayerId();
    const top = current.stack.at(-1);
    const response = availableCounterspellResponse(current, playerId);
    return `
      <section class="response-prompt" data-testid="response-prompt">
        <span class="response-pulse"></span>
        <div>
          <span class="eyebrow">RESPONSE WINDOW</span>
          <h2>${responseWindowMessage(top, mode)}</h2>
          <p>The action is pending. Counter it or let it resolve.</p>
          ${response ? "" : '<p class="response-note">(You don\'t have any instant-speed cards to respond with.)</p>'}
        </div>
        <div class="decision-actions">
          ${response ? '<button class="primary-action response-action" data-action="counter">COUNTERSPELL · 1</button>' : ""}
          ${responsePassButton()}
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
    const winner = current.result?.winner;
    if (!winner) {
      return "";
    }
    const message = resultMessageFor(winner, localPlayerId());
    const heading = mode === "hotseat"
      ? `Player ${winner === HUMAN ? 1 : 2} wins`
      : message.outcome === "win" ? "Victory" : "Defeat";
    return `
      <div class="decision-backdrop">
        <section class="decision-panel result-panel" data-testid="result-prompt">
          <span class="eyebrow">MATCH COMPLETE</span>
          <h1>${heading}</h1>
          ${resultMessageMarkup(message)}
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
          options.push(createFusionUpgradeOption(fusionCard, baseCard));
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
    dismissCoachMarkForCard(cardId);
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
      targetConfirmation = null;
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
      targetConfirmation = null;
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
    if (online) {
      pendingTarget = null;
      targetConfirmation = null;
      sendOnlineIntent(
        { kind: "cast-spell", cardId: card.instanceId, target, payWith },
        `${card.name} sent to the server.`,
      );
      return;
    }
    try {
      pendingTarget = null;
      targetConfirmation = null;
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
      const fusionKey = availableFusions(localPlayerId())
        .map((option) => option.parentIds.join("+"))
        .join("|");
      dismissedFusionKey = update.fusionDeclined ? fusionKey : "";
      if (oldStack.length > 0 && state.stack.length === 0) {
        animateStackResolution(oldStack, state);
      } else {
        syncScene(before, state);
      }
      showUpgradeReveals(before, state);
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
    registerAiFusionActions(before, result.actions, result.state);
    state = result.state;

    if (oldStack.length > 0 && result.actions.some((action) => action.kind === "pass-response")) {
      animateStackResolution(oldStack, state);
    }
    animateAiImmediateActions(before, result.actions);
    syncScene(before, state);
    showUpgradeReveals(before, state);

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
    before: MatchState,
    actions: readonly AiAction[],
    nextState: MatchState,
  ): void {
    const fusionAction = actions.find(
      (action): action is Extract<AiAction, { kind: "fuse" }> =>
        action.kind === "fuse",
    );
    const pendingFusion = nextState.stack.find((item) => item.kind === "fusion");
    if (fusionAction && pendingFusion) {
      registerPendingFusion(before, pendingFusion, fusionAction.parentIds);
      fusionAction.parentIds.forEach((id) => retainedSceneIds.add(id));
    }
  }

  function registerPendingFusion(
    before: MatchState,
    pending: Extract<PendingStackItem, { kind: "fusion" }>,
    sourceIds: readonly [string, string],
  ): void {
    pendingFusionSources.set(pending.stackId, sourceIds);
    const first = findMonster(before, sourceIds[0]);
    const second = findMonster(before, sourceIds[1]);
    if (
      first?.card.category !== "base-monster" ||
      second?.card.category !== "base-monster"
    ) {
      return;
    }
    pendingFusionReveals.set(
      pending.stackId,
      fusionRevealFromEvent([first.card, second.card], pending),
    );
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

  function showUpgradeReveals(before: MatchState, after: MatchState): void {
    for (const playerId of [HUMAN, AI]) {
      const reveals = upgradeRevealsFromTransition(
        getPlayer(before, playerId).monsters,
        getPlayer(after, playerId).monsters,
      );
      for (const reveal of reveals) {
        fusionReveal.showUpgrade(reveal);
        options.sfx?.announceSummon(reveal.result.name, "fusion");
      }
    }
  }

  function animateStackResolution(
    stack: readonly PendingStackItem[],
    resolvedState: MatchState,
  ): void {
    const outcome = resolveStackEvents(stack);
    for (const item of outcome.resolved) {
      if (item.kind === "fusion") {
        const reveal = pendingFusionReveals.get(item.stackId);
        if (reveal) {
          fusionReveal.show(reveal);
        }
        const sources = pendingFusionSources.get(item.stackId);
        if (sources && sources.every((id) => arena.getMonster(id))) {
          const resultObject = createMonsterModel(item.card.name as AssignedMonsterId);
          arena.stageFusion(sources, item.card.instanceId, resultObject);
          sceneIds.add(item.card.instanceId);
          options.sfx?.announceSummon(item.card.name, "fusion");
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
        pendingFusionReveals.delete(item.stackId);
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
        pendingFusionReveals.delete(item.stackId);
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

    reconcileArenaOccupancy(nextIds);

    if (summonTip.shouldShow(before, after, localPlayerId())) {
      showSummonTip();
    }

    for (const id of [...sceneIds]) {
      if (!nextIds.has(id)) {
        arena.setMonsterSummoningSickness(id, false);
        if (!retainedSceneIds.has(id)) {
          retireMonster(id, wasMonsterDestroyed(before, after, id));
        }
      }
    }

    for (const entry of nextMonsters) {
      const id = entry.monster.card.instanceId;
      const summoningSick = hasSummoningSickness(after, entry.monster);
      if (sceneIds.has(id)) {
        arena.setMonsterSummoningSickness(id, summoningSick);
        continue;
      }
      const slot = firstOpenSlot(entry.side);
      if (slot === null) {
        throw new Error(
          `Arena reconciliation failed: no ${entry.side} slot for legal monster ${id}`,
        );
      }
      arena.placeMonster(
        id,
        { side: entry.side, slot },
        createMonsterModel(entry.monster.card.name as AssignedMonsterId),
      );
      sceneIds.add(id);
      arena.setMonsterSummoningSickness(id, summoningSick);
      options.sfx?.announceSummon(entry.monster.card.name, "summon");
      arena.dispatchAnimation({ type: "summon", monsterId: id });
    }
  }

  /**
   * Animation cleanup may leave an object alive briefly after rules retire its
   * permanent. Such objects must not reserve a live board slot for the next
   * resolved summon. Treat MatchState as the authority and repair the local
   * registry before placing anything new.
   */
  function reconcileArenaOccupancy(nextIds: ReadonlySet<string>): void {
    for (const side of ["player", "opponent"] as const) {
      for (const slot of [0, 1, 2] as const) {
        const object = arena.getMonsterAt({ side, slot });
        if (!object) {
          continue;
        }
        const monsterId = object.userData.monsterId;
        if (typeof monsterId !== "string" || !nextIds.has(monsterId)) {
          if (typeof monsterId !== "string") {
            throw new Error(
              `Arena reconciliation failed: ${side}:${slot} has an unnamed monster object`,
            );
          }
          arena.removeMonster(monsterId);
          sceneIds.delete(monsterId);
          retainedSceneIds.delete(monsterId);
          continue;
        }
        sceneIds.add(monsterId);
      }
    }

    for (const monsterId of [...sceneIds]) {
      if (!arena.getMonster(monsterId)) {
        sceneIds.delete(monsterId);
      }
    }
  }

  function showSummonTip(): void {
    summonTipVisible = true;
    window.clearTimeout(summonTipTimer);
    summonTipTimer = window.setTimeout(() => {
      summonTipVisible = false;
      if (!disposed) {
        render();
      }
    }, SUMMON_TIP_DURATION_MS);
  }

  function showCoachMark(): void {
    window.clearTimeout(coachMarkTimer);
    coachMarkTimer = window.setTimeout(() => {
      coachMarkTimer = undefined;
      coachMarks.dismiss();
      if (!disposed) {
        render();
      }
    }, COACH_MARK_DURATION_MS);
  }

  function handleMonsterPointerMove(event: PointerEvent): void {
    if (!arenaCanvas) {
      return;
    }
    const bounds = arenaCanvas.getBoundingClientRect();
    if (
      bounds.width === 0 ||
      bounds.height === 0 ||
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    ) {
      hideMonsterTooltip();
      return;
    }

    const normalizedX = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    const normalizedY = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    const monsterId = arena.pickMonsterAt(normalizedX, normalizedY);
    const monster = monsterId ? findMonster(state, monsterId) : null;
    if (!monster) {
      hideMonsterTooltip();
      return;
    }

    arenaCanvas.style.cursor = "help";
    monsterTooltip.show(
      monsterTooltipContent(monster, hasSummoningSickness(state, monster)),
      event.clientX,
      event.clientY,
    );
  }

  function hideMonsterTooltip(): void {
    arenaCanvas?.style.removeProperty("cursor");
    monsterTooltip.hide();
  }

  function handleSpellTooltipPointerMove(event: PointerEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) {
      hideSpellTooltip();
      return;
    }

    const trigger = target.closest<HTMLElement>("[data-spell-tooltip-id]");
    const content = spellTooltipContent(trigger?.dataset.spellTooltipId ?? "");
    if (!content) {
      hideSpellTooltip();
      return;
    }

    spellTooltip.show(content, event.clientX, event.clientY);
  }

  function hideSpellTooltip(): void {
    spellTooltip.hide();
  }

  function dismissCoachMarkForCard(cardId: string): void {
    if (!coachMarks.dismissForCard(cardId)) {
      return;
    }
    window.clearTimeout(coachMarkTimer);
    coachMarkTimer = undefined;
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
    const target = state.stack.at(-1);
    const response = availableCounterspellResponse(state, playerId);
    if (!response || !target) {
      return;
    }
    if (sendOnlineIntent(
      {
        kind: "counterspell",
        cardId: response.card.instanceId,
        targetStackId: target.stackId,
        payWith: response.payWith,
      },
      "Counterspell sent to the server.",
    )) {
      return;
    }
    try {
      applyState(
        castCounterspell(
          state,
          playerId,
          response.card.instanceId,
          target.stackId,
          response.payWith,
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
      selectSpellTarget(card, { kind: "monster", playerId: owner, monsterId });
    }
  }

  function selectSpellTarget(card: SpellCard, target: SpellTarget): void {
    if (requiresSelfTargetConfirmation(card.effect, localPlayerId(), target.playerId)) {
      targetConfirmation = target;
      render();
      return;
    }
    castLocalSpell(card, target);
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
    interruptDrawAnimations();
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
          sendOnlineIntent({ kind: "fuse", parentIds: [first, second] }, "Fusion sent to the server.");
          return;
        }
        try {
          const next = fuseMonsters(state, localPlayerId(), [first, second]);
          const pending = next.stack.find((item) => item.kind === "fusion");
          if (pending) {
            registerPendingFusion(state, pending, [first, second]);
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
        if (online) {
          sendOnlineIntent(
            { kind: "dismiss-fusion", fusionKey: button.dataset.fusionKey ?? "" },
            "Fusion declined.",
          );
          return;
        }
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
          showUpgradeReveals(before, state);
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
          selectSpellTarget(card, { kind: "player", playerId });
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
        targetConfirmation = null;
        notice = "Spell targeting canceled.";
        render();
        return;
      case "confirm-target": {
        const card = pendingTarget ? findSpellByInstance(pendingTarget.cardId) : null;
        if (card && targetConfirmation) {
          castLocalSpell(card, targetConfirmation);
        }
        return;
      }
      case "cancel-target-confirm":
        targetConfirmation = null;
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
        interruptDrawAnimations();
        for (const id of [...sceneIds]) {
          arena.removeMonster(id);
        }
        sceneIds.clear();
        retainedSceneIds.clear();
        pendingFusionSources.clear();
        pendingFusionReveals.clear();
        selectedAttackers.clear();
        pendingTarget = null;
        targetConfirmation = null;
        pendingAttack = null;
        dismissedFusionKey = "";
        summonTip.reset();
        summonTipVisible = false;
        window.clearTimeout(summonTipTimer);
        coachMarks.reset();
        window.clearTimeout(coachMarkTimer);
        coachMarkTimer = undefined;
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
  hud.addEventListener("pointermove", handleSpellTooltipPointerMove);
  hud.addEventListener("pointerleave", hideSpellTooltip);
  arenaCanvas?.addEventListener("pointermove", handleMonsterPointerMove);
  arenaCanvas?.addEventListener("pointerleave", hideMonsterTooltip);
  const repositionCoachMarkPointers = () =>
    applyCoachMarkTargets(hud, coachMarks.current());
  window.addEventListener("resize", repositionCoachMarkPointers);
  const removePhaseAdvanceShortcut = installPhaseAdvanceShortcut(
    document,
    hud,
    () => document.activeElement,
    () => ({
      targetingActive: pendingTarget !== null,
      responseWindowOpen: state.responsePlayer !== null,
      mulliganDecisionPending: state.phase === "mulligan",
      hotseatCurtainOpen: privacyCurtain !== null,
    }),
  );
  render();
  scheduleAi();

  return {
    getState: () => state,
    dispose() {
      disposed = true;
      window.clearTimeout(aiTimer);
      window.clearTimeout(emptyCombatTimer);
      window.clearTimeout(summonTipTimer);
      window.clearTimeout(coachMarkTimer);
      clearAnimationTimers();
      interruptDrawAnimations();
      for (const id of [...sceneIds]) {
        arena.removeMonster(id);
      }
      sceneIds.clear();
      retainedSceneIds.clear();
      pendingFusionSources.clear();
      pendingFusionReveals.clear();
      unsubscribeOnline();
      options.sfx?.setAmbientMonsterCount(0);
      hud.removeEventListener("click", handleClick);
      hud.removeEventListener("pointermove", handleSpellTooltipPointerMove);
      hud.removeEventListener("pointerleave", hideSpellTooltip);
      arenaCanvas?.removeEventListener("pointermove", handleMonsterPointerMove);
      arenaCanvas?.removeEventListener("pointerleave", hideMonsterTooltip);
      hideMonsterTooltip();
      window.removeEventListener("resize", repositionCoachMarkPointers);
      removePhaseAdvanceShortcut();
      hud.remove();
      drawLayer.remove();
      fusionReveal.dispose();
      monsterTooltip.dispose();
      spellTooltip.dispose();
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

export function responseWindowMessage(
  item: PendingStackItem | undefined,
  mode: MatchMode | "online",
): string {
  if (!item) {
    return "An action is pending.";
  }
  const actor = mode === "hotseat"
    ? `Player ${item.controller === HUMAN ? 1 : 2}`
    : "Your opponent";
  if (item.kind === "summon") {
    return `${actor} has summoned ${item.card.name}.`;
  }
  if (item.kind === "fusion") {
    return `${actor} is fusing ${item.parentNames.join(" + ")}.`;
  }
  return `${actor} has cast ${item.card.name}.`;
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
