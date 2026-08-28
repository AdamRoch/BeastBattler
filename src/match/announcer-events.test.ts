import { describe, expect, it } from "vitest";

import type { CombatPlan } from "../rules/combat";
import type { MatchResult, PlayerId } from "../rules/core";
import {
  combatAnnouncement,
  createAnnouncementDeduper,
  fusionCompletionAnnouncement,
  resultAnnouncement,
} from "./announcer-events";

const plan = (blocks: number): CombatPlan => ({
  attackingPlayer: "player-1",
  defendingPlayer: "player-2",
  attackerIds: ["attacker"],
  turnNumber: 3,
  blocks: Array.from({ length: blocks }, (_, index) => ({
    attackerId: `attacker-${index}`,
    blockerId: `blocker-${index}`,
  })),
});

const result = (reason: MatchResult["reason"]): MatchResult => ({
  winner: "player-1",
  loser: "player-2",
  reason,
});

describe("announcer event selection", () => {
  it("uses the special three-star line instead of generic fusion completion", () => {
    expect(fusionCompletionAnnouncement(2)).toBe("fusion-complete");
    expect(fusionCompletionAnnouncement(3)).toBe("three-star-fusion");
  });

  it("gives final blow precedence over direct and blocked attack lines", () => {
    expect(combatAnnouncement(plan(0), null)).toBe("direct-attack");
    expect(combatAnnouncement(plan(1), null)).toBe("attack-blocked");
    expect(combatAnnouncement(plan(0), result("life"))).toBe("final-blow");
    expect(combatAnnouncement(plan(1), result("life"))).toBe("final-blow");
  });

  it.each([
    ["deck-out", "player-1", "opposing-deck-ran-dry"],
    ["deck-out", "player-2", "your-deck-ran-dry"],
    ["life", "player-1", "opposing-life-counter-reached-zero"],
    ["life", "player-2", "your-life-counter-reached-zero"],
  ] as const)("uses the local perspective for %s", (reason, viewer, line) => {
    expect(resultAnnouncement(result(reason), viewer as PlayerId)).toBe(line);
  });

  it("suppresses repeated announcements for a replayed event", () => {
    const deduper = createAnnouncementDeduper();
    expect(deduper.once("combat:3", "direct-attack")).toBe("direct-attack");
    expect(deduper.once("combat:3", "direct-attack")).toBeNull();
    expect(deduper.once("combat:4", "direct-attack")).toBe("direct-attack");
  });
});
