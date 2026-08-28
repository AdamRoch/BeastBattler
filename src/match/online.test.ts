import { describe, expect, it, vi } from "vitest";

import { assembleDeck, deriveExtraDeck } from "../cards/catalog";
import type { OnlineMatchSession } from "../lobby/online-lobby";
import { createMatch, type PlayerId } from "../rules/core";
import type { ClientMessage, ServerMessage } from "../server/protocol";
import { RoomManager, type RoomConnection } from "../server/room-manager";
import { filterMatchState } from "../server/state-filter";
import { OnlineMatchClient, toLocalMatchState, type WebSocketLike } from "./online";

class TestSocket implements WebSocketLike {
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly sent: string[] = [];
  outbound: ((message: Exclude<ClientMessage, { type: "hello" }>) => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
    this.outbound?.(JSON.parse(data) as Exclude<ClientMessage, { type: "hello" }>);
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

class ClientConnection implements RoomConnection {
  readonly received: ServerMessage[] = [];

  constructor(private readonly socket: TestSocket) {}

  send(message: ServerMessage): void {
    this.received.push(message);
    this.socket.receive(message);
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

/** The session the lobby builds when it hands its live socket over. */
function lobbySession(socket: TestSocket): OnlineMatchSession {
  return {
    socket: socket as unknown as WebSocket,
    displayName: "Ada",
    reconnectToken: "resume-token",
    matchId: "match-1",
    playerId: "player-2",
    opponentName: "Lin",
    playerArchetype: "fire-water",
    opponentArchetype: "earth-air",
  };
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
  it("keeps each real server seat in display-local coordinates through mulligans and turns", () => {
    let sequence = 0;
    const manager = new RoomManager({
      random: () => 0.5,
      newId: () => `id-${++sequence}`,
      schedule: () => 0 as never,
      cancel: () => {},
    });
    const firstSocket = new TestSocket();
    const secondSocket = new TestSocket();
    const firstConnection = new ClientConnection(firstSocket);
    const secondConnection = new ClientConnection(secondSocket);
    firstSocket.readyState = 1;
    secondSocket.readyState = 1;
    const first = new OnlineMatchClient(sessionFor(firstSocket, "Ada", "Lin", "player-1"), { arena: {} as never });
    const second = new OnlineMatchClient(sessionFor(secondSocket, "Lin", "Ada", "player-2"), { arena: {} as never });
    first.connect();
    second.connect();

    const firstToken = manager.connect(firstConnection, { type: "hello", version: 1, displayName: "Ada" });
    const secondToken = manager.connect(secondConnection, { type: "hello", version: 1, displayName: "Lin" });
    firstSocket.outbound = (message) => manager.receive(firstToken, message);
    secondSocket.outbound = (message) => manager.receive(secondToken, message);
    manager.receive(firstToken, { type: "lobby.create", name: "Perspective", archetype: "fire-water" });
    const matchId = firstConnection.received.find((message) => message.type === "match.waiting")?.match.id;
    if (!matchId) throw new Error("Missing waiting match");
    manager.receive(secondToken, { type: "lobby.join", matchId, archetype: "earth-air" });

    for (const client of [first, second]) {
      const state = client.getState();
      expect(client.localPlayerId()).toBe("player-1");
      expect(state?.players[0].hand).toHaveLength(4);
      expect(state?.players[0].hand.every((card) => card.name !== "Card back")).toBe(true);
      expect(state?.players[1].hand).toHaveLength(4);
      expect(state?.players[1].hand.every((card) => card.name === "Card back")).toBe(true);
    }

    first.sendIntent({ kind: "mulligan" });
    second.sendIntent({ kind: "keep-hand" });
    expect(first.getState()?.phase).toBe("main");
    expect(second.getState()?.phase).toBe("main");

    playFirstLand(first);
    first.sendIntent({ kind: "advance-phase" });
    first.sendIntent({ kind: "hold-attack" });
    first.sendIntent({ kind: "advance-phase" });
    expect(second.getState()?.activePlayer).toBe("player-1");
    playFirstLand(second);

    const firstResult = {
      ...firstConnection.received.filter((message) => message.type === "match.state").at(-1)!.state,
      result: { winner: "player-1" as PlayerId, loser: "player-2" as PlayerId, reason: "life" as const },
    };
    const secondResult = {
      ...secondConnection.received.filter((message) => message.type === "match.state").at(-1)!.state,
      result: { winner: "player-1" as PlayerId, loser: "player-2" as PlayerId, reason: "life" as const },
    };
    firstSocket.receive({ type: "match.state", matchId, state: firstResult });
    secondSocket.receive({ type: "match.state", matchId, state: secondResult });
    expect(first.getState()?.result).toMatchObject({ winner: "player-1", loser: "player-2" });
    expect(second.getState()?.result).toMatchObject({ winner: "player-2", loser: "player-1" });
  });

  it("accepts an authoritative automatic-draw snapshot that is already in main phase", () => {
    const socket = new TestSocket();
    socket.readyState = 1;
    const client = new OnlineMatchClient(lobbySession(socket), {
      arena: {} as never,
      now: () => 1_000,
      schedule: () => 1,
      cancel: () => {},
    });
    client.connect();

    socket.receive({
      type: "match.state",
      matchId: "match-1",
      state: { ...filteredState(), phase: "main", turnNumber: 2 },
    });

    expect(client.getState()).toMatchObject({ phase: "main", turnNumber: 2 });
    expect(socket.sent).toHaveLength(0);
  });

  it("adopts the lobby socket without resending hello and maps server state", () => {
    const socket = new TestSocket();
    socket.readyState = 1;
    const updates: string[] = [];
    const client = new OnlineMatchClient(lobbySession(socket), {
      arena: {} as never,
      createSocket: () => {
        throw new Error("the adopted socket must not be replaced");
      },
      now: () => 1_000,
      schedule: () => 1,
      cancel: () => {},
    });
    client.subscribe((update) => {
      if (update.notice) updates.push(update.notice);
    });

    client.connect();
    // The lobby already ran the hello/welcome handshake on this socket.
    expect(socket.sent).toHaveLength(0);
    expect(updates.at(-1)).toBe("Matched with Lin.");

    socket.receive({ type: "match.state", matchId: "match-1", state: filteredState() });
    expect(client.getState()?.players[0].id).toBe("player-1");

    // The seat from the lobby session drives intent translation even though
    // this client never saw the first match.started.
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

  it("forwards server decision timers to the online renderer", () => {
    const socket = new TestSocket();
    socket.readyState = 1;
    const client = new OnlineMatchClient(lobbySession(socket), {
      arena: {} as never,
      now: () => 1_000,
      schedule: () => 1,
      cancel: () => {},
    });
    let timers: unknown;
    client.subscribe((update) => {
      if (update.timers) timers = update.timers;
    });
    client.connect();

    socket.receive({
      type: "match.state",
      matchId: "match-1",
      state: {
        ...filteredState(),
        timers: [{ playerId: "player-2", stage: "countdown", deadline: 6_000 }],
        fusionDeclined: false,
      },
    });

    expect(timers).toEqual([{ playerId: "player-2", stage: "countdown", deadline: 6_000 }]);
  });

  it("keeps the adopted socket for a rematch started over the same connection", () => {
    const socket = new TestSocket();
    socket.readyState = 1;
    const updates: string[] = [];
    const client = new OnlineMatchClient(lobbySession(socket), {
      arena: {} as never,
      now: () => 1_000,
      schedule: () => 1,
      cancel: () => {},
    });
    client.subscribe((update) => {
      if (update.notice) updates.push(update.notice);
    });
    client.connect();
    socket.receive({ type: "match.state", matchId: "match-1", state: filteredState() });

    client.requestRematch();
    expect(JSON.parse(socket.sent.at(-1) ?? "{}")).toMatchObject({ type: "match.rematch" });

    socket.receive({
      type: "match.started",
      matchId: "match-1",
      playerId: "player-2",
      opponentName: "Lin",
      playerArchetype: "fire-water",
      opponentArchetype: "earth-air",
    });
    socket.receive({ type: "match.state", matchId: "match-1", state: filteredState() });
    expect(updates).toContain("Matched with Lin.");
    expect(client.getState()?.players[0].id).toBe("player-1");
  });

  it("reconnects with a fresh socket and the session token after the adopted socket closes", () => {
    const adopted = new TestSocket();
    adopted.readyState = 1;
    const replacement = new TestSocket();
    const updates: string[] = [];
    const client = new OnlineMatchClient(lobbySession(adopted), {
      arena: {} as never,
      createSocket: () => replacement,
      socketUrl: "ws://example.test/ws",
      now: () => 1_000,
      schedule: (callback) => {
        callback();
        return 1;
      },
      cancel: () => {},
    });
    client.subscribe((update) => {
      if (update.notice) updates.push(update.notice);
    });

    client.connect();
    adopted.close();
    expect(updates.at(-1)).toBe("Disconnected — rejoining in 60s");

    replacement.open();
    expect(JSON.parse(replacement.sent[0] ?? "{}")).toMatchObject({
      type: "hello",
      displayName: "Ada",
      reconnectToken: "resume-token",
    });

    replacement.receive({ type: "match.resumed", matchId: "match-1" });
    replacement.receive({
      type: "match.started",
      matchId: "match-1",
      playerId: "player-2",
      opponentName: "Lin",
      playerArchetype: "fire-water",
      opponentArchetype: "earth-air",
    });
    replacement.receive({ type: "match.state", matchId: "match-1", state: filteredState() });
    expect(client.getState()?.players[0].id).toBe("player-1");
  });

  it("reports a forfeit win and hands back to the lobby after the notice", () => {
    const socket = new TestSocket();
    socket.readyState = 1;
    const timers: Array<() => void> = [];
    const announce = vi.fn();
    let returned = 0;
    const client = new OnlineMatchClient(lobbySession(socket), {
      arena: {} as never,
      now: () => 1_000,
      schedule: (callback) => {
        timers.push(callback);
        return timers.length;
      },
      cancel: () => {},
      sfx: { announce } as never,
      onReturnToLobby: () => {
        returned += 1;
      },
    });
    const updates: string[] = [];
    client.subscribe((update) => {
      if (update.notice) updates.push(update.notice);
    });
    client.connect();

    socket.receive({
      type: "match.ended",
      matchId: "match-1",
      winner: "player-2",
      loser: "player-1",
      reason: "forfeit",
    });
    expect(updates.at(-1)).toBe("Opponent forfeited. You win.");
    expect(announce).toHaveBeenCalledWith("opponent-forfeited-you-win");
    socket.receive({
      type: "match.ended",
      matchId: "match-1",
      winner: "player-2",
      loser: "player-1",
      reason: "forfeit",
    });
    expect(announce).toHaveBeenCalledOnce();
    expect(returned).toBe(0);
    for (const fire of timers.splice(0)) fire();
    expect(returned).toBe(1);
  });
});

function sessionFor(
  socket: TestSocket,
  displayName: string,
  opponentName: string,
  playerId: PlayerId,
): OnlineMatchSession {
  return {
    socket: socket as unknown as WebSocket,
    displayName,
    reconnectToken: `${displayName}-token`,
    matchId: "id-3",
    playerId,
    opponentName,
    playerArchetype: "fire-water",
    opponentArchetype: "earth-air",
  };
}

function playFirstLand(client: OnlineMatchClient): void {
  const land = client.getState()?.players[0].hand.find((card) => card.kind === "land");
  if (!land) throw new Error("Expected the local hand to contain a land");
  client.sendIntent({ kind: "play-land", cardId: land.instanceId });
}
