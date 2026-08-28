import type { AiAction, AiTurnResult } from "../ai/opponent";
import type { GameCard, MatchState } from "../rules/core";

export const AI_PRESENTATION_BEAT_MS = 900;

export interface AiPresentationBeat {
  readonly action: AiAction;
  readonly message: string;
  readonly durationMs: number;
}

export interface PresentationTimer {
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(timer: number | undefined): void;
}

export class AiPresentationQueue {
  private timer: number | undefined;
  private generation = 0;

  constructor(private readonly clock: PresentationTimer) {}

  play(
    beats: readonly AiPresentationBeat[],
    onBeat: (beat: AiPresentationBeat) => void,
    onComplete: () => void,
  ): void {
    this.clear();
    if (beats.length === 0) {
      onComplete();
      return;
    }

    const generation = this.generation;
    let index = 0;
    const advance = () => {
      if (generation !== this.generation) return;
      const beat = beats[index];
      if (!beat) {
        this.timer = undefined;
        onComplete();
        return;
      }
      onBeat(beat);
      index += 1;
      this.timer = this.clock.setTimeout(advance, beat.durationMs);
    };
    advance();
  }

  clear(): void {
    this.generation += 1;
    this.clock.clearTimeout(this.timer);
    this.timer = undefined;
  }
}

export function buildAiPresentation(
  before: MatchState,
  result: AiTurnResult,
): readonly AiPresentationBeat[] {
  return result.actions.map((action, index) => ({
    action,
    message: actionMessage(before, action, index, result),
    durationMs: AI_PRESENTATION_BEAT_MS,
  }));
}

function actionMessage(
  before: MatchState,
  action: AiAction,
  index: number,
  result: AiTurnResult,
): string {
  switch (action.kind) {
    case "play-land":
      return `AI played ${cardName(before, action.cardId)}.`;
    case "summon":
      return `AI summoned ${cardName(before, action.cardId)}. You may respond.`;
    case "fuse":
      return `AI fused ${action.parentIds.map((id) => cardName(before, id)).join(" + ")}. You may respond.`;
    case "upgrade-fusion":
      return `AI fed ${cardName(before, action.baseMonsterId)} to ${cardName(before, action.fusionId)}, upgrading it to ★3.`;
    case "cast-spell":
      return `AI cast ${spellName(action.spellId)}.`;
    case "counterspell":
      return "AI cast Counterspell.";
    case "pass-response":
      return "AI passed priority. The pending action resolves.";
    case "attack":
      return `AI attacked with ${action.attackerIds.map((id) => cardName(before, id)).join(" + ")}. Choose your blocks.`;
    case "hold-attack":
      return "AI chose not to attack and moved to the end phase.";
    case "discard":
      return `AI discarded ${action.cardIds.length} ${action.cardIds.length === 1 ? "card" : "cards"} to reach the hand limit.`;
    case "advance-phase":
      return result.waitingFor === "turn-complete" && index === result.actions.length - 1
        ? "AI ended its turn."
        : "AI moved to the next phase.";
  }
}

function cardName(state: MatchState, cardId: string): string {
  for (const player of state.players) {
    const card = [
      ...player.hand,
      ...player.deck,
      ...player.discardPile,
      ...player.extraDeck,
      ...player.monsters.map((monster) => monster.card),
    ].find((candidate) => candidate.instanceId === cardId);
    if (card) return card.name;
  }
  return "a card";
}

function spellName(spellId: Extract<AiAction, { kind: "cast-spell" }>["spellId"]): GameCard["name"] {
  return spellId === "bolt" ? "Bolt" : "Destroy";
}
