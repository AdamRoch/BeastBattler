import { getPlayer, type MatchState, type PlayerId } from "../rules/core";

export type CoachMarkKind =
  | "land-monster-pairing"
  | "sorcery-timing"
  | "play-a-beast"
  | "play-a-land";

export interface CoachMark {
  readonly kind: CoachMarkKind;
  readonly message: string;
  readonly cardIds: readonly string[];
}

export interface CoachMarkTracker {
  current(): CoachMark | null;
  update(state: MatchState, localPlayerId: PlayerId): CoachMark | null;
  dismiss(): void;
  dismissForCard(cardId: string): boolean;
  reset(): void;
}

export function createCoachMarkTracker(): CoachMarkTracker {
  const shown = new Set<CoachMarkKind>();
  const playersWhoHaveSummonedBaseMonster = new Set<PlayerId>();
  let active: CoachMark | null = null;
  let mainPhaseKey = "";
  let playLandPending = false;

  return {
    current() {
      return active;
    },

    update(state, localPlayerId) {
      if (
        getPlayer(state, localPlayerId).monsters.some(
          (monster) => monster.card.category === "base-monster",
        )
      ) {
        playersWhoHaveSummonedBaseMonster.add(localPlayerId);
      }
      const key = `${state.turnNumber}:${state.activePlayer}:${state.phase}`;
      if (key !== mainPhaseKey) {
        mainPhaseKey = key;
        if (shouldOfferPlayLandTip(state, localPlayerId)) {
          playLandPending = true;
        }
      }

      if (active) {
        return active;
      }

      const next =
        (!shown.has("land-monster-pairing")
          ? findLandMonsterPairingTip(state, localPlayerId)
          : null) ??
        (!shown.has("sorcery-timing")
          ? findSorceryTimingTip(state, localPlayerId)
          : null) ??
        (!shown.has("play-a-beast")
          ? findPlayBeastTip(
            state,
            localPlayerId,
            playersWhoHaveSummonedBaseMonster.has(localPlayerId),
          )
          : null) ??
        (!shown.has("play-a-land") && playLandPending
          ? findPlayLandTip(state, localPlayerId)
          : null);

      if (!next) {
        return null;
      }

      shown.add(next.kind);
      if (next.kind === "play-a-land") {
        playLandPending = false;
      }
      active = next;
      return active;
    },

    dismiss() {
      active = null;
    },

    dismissForCard(cardId) {
      if (!active || !active.cardIds.includes(cardId)) {
        return false;
      }
      active = null;
      return true;
    },

    reset() {
      shown.clear();
      playersWhoHaveSummonedBaseMonster.clear();
      active = null;
      mainPhaseKey = "";
      playLandPending = false;
    },
  };
}

export function coachMarkMarkup(mark: CoachMark): string {
  const signal = mark.kind === "play-a-land"
    ? '<span class="coach-mark-signal" aria-hidden="true">…</span>'
    : "";
  return `
    <aside class="coach-mark coach-mark-${mark.kind}" data-testid="coach-mark-${mark.kind}" role="status">
      ${signal}
      <span class="coach-mark-label">TIP</span>
      <strong>${mark.message}</strong>
    </aside>
  `;
}

export function applyCoachMarkTargets(
  root: ParentNode,
  mark: CoachMark | null,
): void {
  root.querySelector("[data-coach-mark-pointer-layer]")?.remove();
  const targetIds = new Set(mark?.cardIds ?? []);
  const targetCards = [...root.querySelectorAll<HTMLElement>(".hand-card[data-card-id]")];
  targetCards.forEach((card) => {
    card.classList.toggle(
      "is-coach-mark-target",
      targetIds.has(card.dataset.cardId ?? ""),
    );
  });

  if (mark?.kind !== "land-monster-pairing" || !(root instanceof HTMLElement)) {
    return;
  }

  const bubble = root.querySelector<HTMLElement>(
    ".coach-mark-land-monster-pairing",
  );
  const targets = targetCards.filter((card) =>
    targetIds.has(card.dataset.cardId ?? ""),
  );
  if (!bubble || targets.length !== mark.cardIds.length) {
    return;
  }

  appendCoachMarkPointers(root, bubble, targets);
}

function findLandMonsterPairingTip(
  state: MatchState,
  playerId: PlayerId,
): CoachMark | null {
  if (!canActInMainPhase(state, playerId)) {
    return null;
  }

  const player = getPlayer(state, playerId);
  if (player.landPlayedThisTurn || player.monsters.length >= 3) {
    return null;
  }

  for (const land of player.hand) {
    if (land.kind !== "land") {
      continue;
    }
    const monster = player.hand.find(
      (card) =>
        card.kind === "monster" &&
        card.category === "base-monster" &&
        card.element === land.element,
    );
    if (monster) {
      return {
        kind: "land-monster-pairing",
        message: "This land summons this beast.",
        cardIds: [land.instanceId, monster.instanceId],
      };
    }
  }

  return null;
}

function findSorceryTimingTip(
  state: MatchState,
  playerId: PlayerId,
): CoachMark | null {
  if (!canActInMainPhase(state, playerId)) {
    return null;
  }

  const player = getPlayer(state, playerId);
  if (!player.lands.some((land) => land.ready)) {
    return null;
  }

  const spell = player.hand.find(
    (card) =>
      card.kind === "spell" &&
      card.timing === "sorcery" &&
      (card.id !== "destroy" || state.players.some((other) => other.monsters.length > 0)),
  );
  if (!spell) {
    return null;
  }

  return {
    kind: "sorcery-timing",
    message: "Sorcery spells only cast during your own main phase. Instants answer your opponent.",
    cardIds: [spell.instanceId],
  };
}

function findPlayBeastTip(
  state: MatchState,
  playerId: PlayerId,
  hasSummonedBaseMonster: boolean,
): CoachMark | null {
  if (
    !canActInMainPhase(state, playerId) ||
    state.turnNumber > 2 ||
    hasSummonedBaseMonster
  ) {
    return null;
  }

  const player = getPlayer(state, playerId);
  if (player.monsters.length >= 3) {
    return null;
  }

  const readyElements = new Set(
    player.lands.filter((land) => land.ready).map((land) => land.card.element),
  );
  const monster = player.hand.find(
    (card) =>
      card.kind === "monster" &&
      card.category === "base-monster" &&
      readyElements.has(card.element),
  );
  if (!monster) {
    return null;
  }

  return {
    kind: "play-a-beast",
    message: "Consider playing a beast.",
    cardIds: [monster.instanceId],
  };
}

function shouldOfferPlayLandTip(
  state: MatchState,
  playerId: PlayerId,
): boolean {
  if (!canActInMainPhase(state, playerId) || state.turnNumber < 2) {
    return false;
  }

  const player = getPlayer(state, playerId);
  return !player.landPlayedThisTurn && player.hand.some((card) => card.kind === "land");
}

function findPlayLandTip(
  state: MatchState,
  playerId: PlayerId,
): CoachMark | null {
  if (!shouldOfferPlayLandTip(state, playerId)) {
    return null;
  }

  const land = getPlayer(state, playerId).hand.find((card) => card.kind === "land");
  if (!land || land.kind !== "land") {
    return null;
  }

  return {
    kind: "play-a-land",
    message: "Recommend you play a land.",
    cardIds: [land.instanceId],
  };
}

function canActInMainPhase(state: MatchState, playerId: PlayerId): boolean {
  return state.activePlayer === playerId &&
    state.phase === "main" &&
    !state.result &&
    !state.responsePlayer &&
    state.stack.length === 0;
}

function appendCoachMarkPointers(
  root: HTMLElement,
  bubble: HTMLElement,
  targets: readonly HTMLElement[],
): void {
  const rootRect = root.getBoundingClientRect();
  if (rootRect.width === 0 || rootRect.height === 0) {
    return;
  }

  const bubbleRect = bubble.getBoundingClientRect();
  const startX = bubbleRect.left - rootRect.left + bubbleRect.width / 2;
  const startY = bubbleRect.bottom - rootRect.top + 3;
  const layer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  layer.setAttribute("class", "coach-mark-pointer-layer");
  layer.setAttribute("data-coach-mark-pointer-layer", "true");
  layer.setAttribute("aria-hidden", "true");
  layer.setAttribute("viewBox", `0 0 ${rootRect.width} ${rootRect.height}`);
  layer.setAttribute("preserveAspectRatio", "none");

  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
  marker.setAttribute("id", "coach-mark-pointer-head");
  marker.setAttribute("viewBox", "0 0 10 10");
  marker.setAttribute("refX", "8");
  marker.setAttribute("refY", "5");
  marker.setAttribute("markerWidth", "7");
  marker.setAttribute("markerHeight", "7");
  marker.setAttribute("orient", "auto-start-reverse");
  const head = document.createElementNS("http://www.w3.org/2000/svg", "path");
  head.setAttribute("class", "coach-mark-pointer-head");
  head.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
  marker.append(head);
  defs.append(marker);
  layer.append(defs);

  for (const target of targets) {
    const targetRect = target.getBoundingClientRect();
    const endX = targetRect.left - rootRect.left + targetRect.width / 2;
    const endY = targetRect.top - rootRect.top + 12;
    const controlX = (startX + endX) / 2;
    const controlY = Math.max(startY + 48, endY - 58);
    const pointer = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pointer.setAttribute("class", "coach-mark-pointer");
    pointer.setAttribute("data-coach-mark-target-id", target.dataset.cardId ?? "");
    pointer.setAttribute("d", `M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}`);
    pointer.setAttribute("marker-end", "url(#coach-mark-pointer-head)");
    layer.append(pointer);
  }

  root.append(layer);
}
