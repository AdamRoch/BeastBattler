import { describe, expect, it } from "vitest";

import {
  privacyCurtainCopy,
  privacyCurtainForTransition,
  privacyCurtainMarkup,
} from "./privacy-curtain";

describe("hotseat privacy curtain", () => {
  it("names the next player without exposing match content", () => {
    const copy = privacyCurtainCopy({
      playerId: "player-2",
      reason: "turn",
    });

    expect(copy.title).toBe("Player 2");
    expect(copy.instruction).toBe("Player 2 — press when ready");
    expect(privacyCurtainMarkup({
      playerId: "player-2",
      reason: "turn",
    })).toContain('data-action="acknowledge-curtain"');
  });

  it("uses the required response-window copy", () => {
    const copy = privacyCurtainCopy({
      playerId: "player-1",
      reason: "response",
    });

    expect(copy.title).toBe("Opponent may respond");
    expect(copy.instruction).toContain("Pass the device");
  });

  it("renders nothing while no handoff is pending", () => {
    expect(privacyCurtainMarkup(null)).toBe("");
  });

  it("locks every new turn for the next active player", () => {
    expect(privacyCurtainForTransition(
      { activePlayer: "player-1", responsePlayer: null },
      { activePlayer: "player-2", responsePlayer: null },
      "player-1",
    )).toEqual({ playerId: "player-2", reason: "turn" });
  });

  it("locks each response window and the handoff back", () => {
    expect(privacyCurtainForTransition(
      { activePlayer: "player-1", responsePlayer: null },
      { activePlayer: "player-1", responsePlayer: "player-2" },
      "player-1",
    )).toEqual({ playerId: "player-2", reason: "response" });

    expect(privacyCurtainForTransition(
      { activePlayer: "player-1", responsePlayer: "player-2" },
      { activePlayer: "player-1", responsePlayer: null },
      "player-2",
    )).toEqual({ playerId: "player-1", reason: "turn" });
  });
});
