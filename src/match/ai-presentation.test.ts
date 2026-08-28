// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { runAiTurn } from "../ai/opponent";
import { assembleDeck, deriveExtraDeck } from "../cards/catalog";
import { createMatch, type MatchState } from "../rules/core";
import {
  AiPresentationQueue,
  buildAiPresentation,
} from "./ai-presentation";

describe("AI presentation", () => {
  afterEach(() => vi.useRealTimers());

  it("narrates actions in deterministic order before completing", () => {
    vi.useFakeTimers();
    const beats = buildAiPresentation(aiMainState(), runAiTurn(aiMainState(), "player-2"));
    const messages: string[] = [];
    let completions = 0;
    const queue = new AiPresentationQueue(window);

    queue.play(beats, (beat) => messages.push(beat.message), () => completions += 1);

    expect(messages).toEqual(["AI played Earth Land."]);
    expect(completions).toBe(0);
    vi.advanceTimersByTime(beats[0]?.durationMs ?? 0);
    expect(messages[1]).toBe("AI summoned Stone Bull. You may respond.");
    expect(completions).toBe(0);
    vi.advanceTimersByTime(beats[1]?.durationMs ?? 0);
    expect(completions).toBe(1);
  });

  it("cancels pending beats and completion callbacks", () => {
    vi.useFakeTimers();
    const beats = buildAiPresentation(aiMainState(), runAiTurn(aiMainState(), "player-2"));
    const messages: string[] = [];
    let completions = 0;
    const queue = new AiPresentationQueue(window);

    queue.play(beats, (beat) => messages.push(beat.message), () => completions += 1);
    queue.clear();
    vi.runAllTimers();

    expect(messages).toEqual(["AI played Earth Land."]);
    expect(completions).toBe(0);
  });
});

function aiMainState(): MatchState {
  const aiDeck = assembleDeck("earth-lightning");
  const land = aiDeck.find((card) => card.kind === "land" && card.element === "earth");
  const stoneBull = aiDeck.find((card) => card.kind === "monster" && card.name === "Stone Bull");
  if (!land || !stoneBull) throw new Error("Missing AI presentation fixtures");

  const initial = createMatch({
    playerOneDeck: assembleDeck("fire-water"),
    playerTwoDeck: aiDeck,
    playerOneExtraDeck: deriveExtraDeck("fire-water"),
    playerTwoExtraDeck: deriveExtraDeck("earth-lightning"),
    firstPlayer: "player-2",
  });
  return withAi(initial, {
    hand: [land, stoneBull],
    lands: [],
    monsters: [],
    landPlayedThisTurn: false,
    mulliganDecision: "kept",
  });
}

function withAi(
  state: MatchState,
  updates: Partial<MatchState["players"][number]>,
): MatchState {
  const players = [state.players[0], { ...state.players[1], ...updates }] as MatchState["players"];
  return { ...state, activePlayer: "player-2", phase: "main", turnNumber: 4, players };
}
