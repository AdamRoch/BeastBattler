import { describe, expect, it } from "vitest";

import type { ServerMessage } from "./protocol";
import { RECONNECT_GRACE_MS, RoomManager, type RoomConnection } from "./room-manager";

class TestConnection implements RoomConnection {
  readonly messages: ServerMessage[] = [];

  send(message: ServerMessage): void {
    this.messages.push(message);
  }

  last<Type extends ServerMessage["type"]>(type: Type): Extract<ServerMessage, { type: Type }> {
    const message = [...this.messages].reverse().find((candidate) => candidate.type === type);
    if (!message) throw new Error(`Missing ${type}`);
    return message as Extract<ServerMessage, { type: Type }>;
  }
}

function managerWithClock() {
  let now = 1_000;
  let sequence = 0;
  const timers: Array<() => void> = [];
  const manager = new RoomManager({
    now: () => now,
    random: () => 0.5,
    newId: () => `id-${++sequence}`,
    schedule: (callback) => {
      timers.push(callback);
      return timers.length;
    },
    cancel: () => {},
  });
  return { manager, timers, setNow: (next: number) => { now = next; } };
}

function connectPair(manager: RoomManager) {
  const first = new TestConnection();
  const second = new TestConnection();
  const firstToken = manager.connect(first, { type: "hello", version: 1, displayName: "Ada" });
  const secondToken = manager.connect(second, { type: "hello", version: 1, displayName: "Lin" });
  return { first, second, firstToken, secondToken };
}

describe("RoomManager lobby protocol", () => {
  it("pushes match-list changes and starts a match when the second seat joins", () => {
    const { manager } = managerWithClock();
    const { first, second, firstToken, secondToken } = connectPair(manager);

    manager.receive(firstToken, { type: "lobby.create", name: "After work", archetype: "fire-water" });

    const listing = second.last("lobby.snapshot");
    expect(listing.matches).toHaveLength(1);
    expect(listing.matches[0]).toMatchObject({ name: "After work", creatorName: "Ada" });

    manager.receive(secondToken, { type: "lobby.join", matchId: listing.matches[0].id, archetype: "earth-air" });

    expect(manager.openMatches()).toEqual([]);
    expect(first.last("match.started")).toMatchObject({ playerId: "player-1", opponentName: "Lin" });
    expect(second.last("match.state").state.you.id).toBe("player-2");
    expect(first.last("match.state").state.opponent.handCount).toBe(4);
  });

  it("rejects illegal actions without broadcasting a changed state", () => {
    const { manager } = managerWithClock();
    const { first, second, firstToken, secondToken } = connectPair(manager);
    manager.receive(firstToken, { type: "lobby.create", name: "Rules", archetype: "fire-water" });
    const matchId = manager.openMatches()[0].id;
    manager.receive(secondToken, { type: "lobby.join", matchId, archetype: "earth-air" });
    const stateMessages = first.messages.filter((message) => message.type === "match.state").length;

    manager.receive(secondToken, { type: "match.intent", intent: { kind: "advance-phase" } });

    expect(second.last("error")).toMatchObject({ code: "illegal_intent" });
    expect(first.messages.filter((message) => message.type === "match.state")).toHaveLength(stateMessages);
  });

  it("removes an abandoned waiting match and pushes the new lobby list", () => {
    const { manager } = managerWithClock();
    const { first, second, firstToken } = connectPair(manager);
    manager.receive(firstToken, { type: "lobby.create", name: "Gone", archetype: "fire-water" });

    manager.disconnect(firstToken, first);

    expect(manager.openMatches()).toEqual([]);
    expect(second.last("lobby.snapshot").matches).toEqual([]);
  });
});

describe("RoomManager reconnect handling", () => {
  it("pauses for the grace window, resumes with the same token, and cancels the forfeit", () => {
    const { manager, timers, setNow } = managerWithClock();
    const { first, second, firstToken, secondToken } = connectPair(manager);
    manager.receive(firstToken, { type: "lobby.create", name: "Reconnect", archetype: "fire-water" });
    manager.receive(secondToken, { type: "lobby.join", matchId: manager.openMatches()[0].id, archetype: "earth-air" });

    manager.disconnect(firstToken, first);
    expect(second.last("match.paused")).toMatchObject({
      disconnectedPlayer: "player-1",
      remainingMs: RECONNECT_GRACE_MS,
      reconnectDeadline: 1_000 + RECONNECT_GRACE_MS,
    });

    setNow(2_000);
    const reconnected = new TestConnection();
    manager.connect(reconnected, { type: "hello", version: 1, reconnectToken: firstToken });
    expect(second.last("match.resumed")).toMatchObject({ type: "match.resumed" });
    expect(reconnected.last("match.state").state.you.id).toBe("player-1");

    timers[0]();
    expect(second.messages.some((message) => message.type === "match.ended" && message.reason === "forfeit")).toBe(false);
  });

  it("forfeits after the grace callback and returns the connected player to the lobby", () => {
    const { manager, timers } = managerWithClock();
    const { first, second, firstToken, secondToken } = connectPair(manager);
    manager.receive(firstToken, { type: "lobby.create", name: "Timeout", archetype: "fire-water" });
    manager.receive(secondToken, { type: "lobby.join", matchId: manager.openMatches()[0].id, archetype: "earth-air" });

    manager.disconnect(firstToken, first);
    timers[0]();

    expect(second.last("match.ended")).toMatchObject({ winner: "player-2", loser: "player-1", reason: "forfeit" });
    expect(second.last("lobby.snapshot").matches).toEqual([]);
  });
});
