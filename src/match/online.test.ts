import { describe, expect, it } from "vitest";

import { assembleDeck, deriveExtraDeck } from "../cards/catalog";
import { createMatch } from "../rules/core";
import { filterMatchState } from "../server/state-filter";
import { OnlineMatchClient, toLocalMatchState, type WebSocketLike } from "./online";

class TestSocket implements WebSocketLike {
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly sent: string[] = [];

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.({} as CloseEvent);
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.({} as Event);
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent<string>);
  }
}

function matchState() {
  return createMatch({
    playerOneDeck: assembleDeck("fire-water"),
    playerTwoDeck: assembleDeck("earth-air"),
    playerOneExtraDeck: deriveExtraDeck("fire-water"),
    playerTwoExtraDeck: deriveExtraDeck("earth-air"),
  });
}

function filteredState() {
  return filterMatchState(matchState(), "player-2");
}

describe("toLocalMatchState", () => {
  it("keeps the viewer as the local player and represents the opponent hand only by count", () => {
    const source = filteredState();
    const hiddenOpponentCardId = matchState().players[0].hand[0].instanceId;
    const local = toLocalMatchState(source);

    expect(local.players[0].id).toBe("player-1");
    expect(local.players[0].hand).toEqual(source.you.hand);
    expect(local.players[1].hand).toHaveLength(source.opponent.handCount);
    expect(local.players[1].hand.every((card) => card.name === "Card back")).toBe(true);
    expect(local.players[1].hand).not.toEqual(source.you.hand);
    expect(JSON.stringify(local)).not.toContain(hiddenOpponentCardId);
  });
});

describe("OnlineMatchClient", () => {
  it("reconnects with the session token, maps server state, and translates target player ids", () => {
    const socket = new TestSocket();
    const updates: string[] = [];
    const client = new OnlineMatchClient({
      displayName: "Ada",
      reconnectToken: "resume-token",
      matchId: "match-1",
      playerArchetype: "fire-water",
      opponentArchetype: "earth-air",
      socketUrl: "ws://example.test/ws",
    }, {
      arena: {} as never,
      createSocket: () => socket,
      now: () => 1_000,
      schedule: () => 1,
      cancel: () => {},
    });
    client.subscribe((update) => {
      if (update.notice) updates.push(update.notice);
    });

    client.connect();
    socket.open();
    expect(JSON.parse(socket.sent[0])).toMatchObject({
      type: "hello",
      reconnectToken: "resume-token",
    });

    socket.receive({ type: "match.started", matchId: "match-1", playerId: "player-2", opponentName: "Lin" });
    socket.receive({ type: "match.state", matchId: "match-1", state: filteredState() });
    expect(client.getState()?.players[0].id).toBe("player-1");

    client.sendIntent({
      kind: "cast-spell",
      cardId: "spell-1",
      payWith: "fire",
      target: { kind: "player", playerId: "player-2" },
    });
    expect(JSON.parse(socket.sent.at(-1) ?? "{}")).toMatchObject({
      type: "match.intent",
      intent: { target: { playerId: "player-1" } },
    });

    socket.receive({
      type: "match.paused",
      matchId: "match-1",
      disconnectedPlayer: "player-1",
      reconnectDeadline: 61_000,
      remainingMs: 60_000,
    });
    expect(updates.at(-1)).toBe("Opponent disconnected — waiting 60s");
  });
});
