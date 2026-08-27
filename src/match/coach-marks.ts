import { getPlayer, type MatchState, type PlayerId } from "../rules/core";

export type CoachMarkKind =
  | "land-monster-pairing"
  | "sorcery-timing"
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
  let active: CoachMark | null = null;
  let mainPhaseKey = "";
  let playLandPending = false;

  return {
    current() {
      return active;
    },

    update(state, localPlayerId) {
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
  const targetIds = new Set(mark?.cardIds ?? []);
  root.querySelectorAll<HTMLElement>(".hand-card[data-card-id]").forEach((card) => {
    card.classList.toggle(
      "is-coach-mark-target",
      targetIds.has(card.dataset.cardId ?? ""),
    );
  });
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
