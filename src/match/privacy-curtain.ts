import type { PlayerId } from "../rules/core";

export type PrivacyCurtainReason = "turn" | "response";

export interface PrivacyCurtainRequest {
  readonly playerId: PlayerId;
  readonly reason: PrivacyCurtainReason;
}

export interface PrivacyCurtainCopy {
  readonly eyebrow: string;
  readonly title: string;
  readonly instruction: string;
  readonly buttonLabel: string;
}

export interface PrivacyTransitionState {
  readonly activePlayer: PlayerId;
  readonly responsePlayer: PlayerId | null;
}

export function privacyCurtainForTransition(
  before: PrivacyTransitionState,
  after: PrivacyTransitionState,
  viewingPlayer: PlayerId,
): PrivacyCurtainRequest | null {
  if (after.responsePlayer && after.responsePlayer !== before.responsePlayer) {
    return { playerId: after.responsePlayer, reason: "response" };
  }
  if (after.activePlayer !== before.activePlayer) {
    return { playerId: after.activePlayer, reason: "turn" };
  }
  if (
    before.responsePlayer &&
    !after.responsePlayer &&
    viewingPlayer !== after.activePlayer
  ) {
    return { playerId: after.activePlayer, reason: "turn" };
  }
  return null;
}

export function privacyCurtainCopy(
  request: PrivacyCurtainRequest,
): PrivacyCurtainCopy {
  const playerNumber = request.playerId === "player-1" ? 1 : 2;
  if (request.reason === "response") {
    return {
      eyebrow: `PLAYER ${playerNumber} RESPONSE`,
      title: "Opponent may respond",
      instruction: "Pass the device. Keep your hand hidden until they are ready.",
      buttonLabel: `PLAYER ${playerNumber} READY`,
    };
  }
  return {
    eyebrow: "PASS THE DEVICE",
    title: `Player ${playerNumber}`,
    instruction: `Player ${playerNumber} — press when ready`,
    buttonLabel: `I'M PLAYER ${playerNumber}`,
  };
}

export function privacyCurtainMarkup(
  request: PrivacyCurtainRequest | null,
): string {
  if (!request) {
    return "";
  }
  const copy = privacyCurtainCopy(request);
  return `
    <div class="privacy-curtain" data-testid="privacy-curtain" role="dialog" aria-modal="true" aria-labelledby="privacy-curtain-title">
      <section class="privacy-curtain-panel">
        <span class="eyebrow">${copy.eyebrow}</span>
        <h1 id="privacy-curtain-title">${copy.title}</h1>
        <p>${copy.instruction}</p>
        <button class="primary-action" data-action="acknowledge-curtain">${copy.buttonLabel}</button>
      </section>
    </div>
  `;
}
