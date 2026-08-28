import { describe, expect, it } from "vitest";

import type { ServerMessage } from "../server/protocol";
import {
  mountOnlineLobby,
  type OnlineMatchSession,
} from "./online-lobby";

class FakeSocket {
  readyState = 0;
  readonly sent: string[] = [];
  closeCalls = 0;
  private readonly listeners = new Map<string, Set<EventListener>>();

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeCalls += 1;
    this.readyState = 3;
    this.emit("close", {} as Event);
  }

  addEventListener(type: string, listener: EventListener): void {
    const bucket = this.listeners.get(type) ?? new Set<EventListener>();
    bucket.add(listener);
    this.listeners.set(type, bucket);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  open(): void {
    this.readyState = 1;
    this.emit("open", {} as Event);
  }

  receive(message: ServerMessage): void {
    this.emit("message", { data: JSON.stringify(message) } as MessageEvent<string>);
  }

  private emit(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class FakeRoot {
  innerHTML = "";
  private readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener): void {
    const bucket = this.listeners.get(type) ?? new Set<EventListener>();
    bucket.add(listener);
    this.listeners.set(type, bucket);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  querySelector(selector: string): unknown {
    return selector === "[data-match-name]" ? { value: "Friday night duel" } : null;
  }

  click(action: string, dataset: Record<string, string> = {}): void {
    const event = {
      target: {
        closest: (selector: string) =>
          selector === "[data-lobby-action]"
            ? { dataset: { lobbyAction: action, ...dataset } }
            : null,
      },
    } as unknown as Event;
    for (const listener of this.listeners.get("click") ?? []) listener(event);
  }
}

class FakeStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const MATCH = {
  id: "match-1",
  name: "Friday night duel",
  creatorName: "Ada",
  creatorArchetype: "fire-water" as const,
};

function mountLobby(storage: FakeStorage, sessions: OnlineMatchSession[], socket: FakeSocket) {
  const root = new FakeRoot();
  mountOnlineLobby(root as unknown as HTMLElement, {
    startMatch: (session) => sessions.push(session),
    onReturnToTitle: () => {},
    createSocket: () => socket,
    storage,
  });
  return root;
}

describe("mountOnlineLobby", () => {
  it("hands the live socket and match payload to startMatch when the match starts", () => {
    const storage = new FakeStorage();
    storage.setItem("beast-battler.display-name", "Ada");
    const socket = new FakeSocket();
    const sessions: OnlineMatchSession[] = [];
    const root = mountLobby(storage, sessions, socket);

    socket.open();
    expect(JSON.parse(socket.sent[0] ?? "{}")).toMatchObject({
      type: "hello",
      displayName: "Ada",
    });

    socket.receive({ type: "welcome", version: 1, reconnectToken: "token-1", displayName: "Ada" });
    expect(storage.getItem("beast-battler.reconnect-token")).toBe("token-1");

    root.click("create");
    root.click("pick-archetype", { archetype: "fire-water" });
    root.click("submit-create");
    expect(JSON.parse(socket.sent.at(-1) ?? "{}")).toMatchObject({
      type: "lobby.create",
      name: "Friday night duel",
      archetype: "fire-water",
    });

    socket.receive({ type: "match.waiting", match: MATCH });
    expect(root.innerHTML).toContain('data-testid="online-waiting-screen"');

    socket.receive({
      type: "match.started",
      matchId: "match-1",
      playerId: "player-1",
      opponentName: "Lin",
      playerArchetype: "fire-water",
      opponentArchetype: "earth-air",
    });

    expect(sessions).toHaveLength(1);
    const session = sessions[0];
    expect(session.socket).toBe(socket as unknown as WebSocket);
    expect(session).toMatchObject({
      displayName: "Ada",
      reconnectToken: "token-1",
      matchId: "match-1",
      playerId: "player-1",
      opponentName: "Lin",
      playerArchetype: "fire-water",
      opponentArchetype: "earth-air",
    });

    // The lobby detaches its listeners but leaves the socket open for the match.
    expect(socket.closeCalls).toBe(0);
    expect(socket.listenerCount("message")).toBe(0);
    expect(root.listenerCount("click")).toBe(0);
  });

  it("renders pushed lobby snapshots", () => {
    const storage = new FakeStorage();
    storage.setItem("beast-battler.display-name", "Ada");
    const socket = new FakeSocket();
    const root = mountLobby(storage, [], socket);

    socket.open();
    socket.receive({ type: "welcome", version: 1, reconnectToken: "token-1", displayName: "Ada" });
    socket.receive({ type: "lobby.snapshot", matches: [MATCH] });

    expect(root.innerHTML).toContain('data-testid="online-lobby-screen"');
    expect(root.innerHTML).toContain("Friday night duel");
    expect(root.innerHTML).toContain("Hosted by Ada");
  });

  it("resumes identity with the stored reconnect token on a fresh lobby mount", () => {
    const storage = new FakeStorage();
    storage.setItem("beast-battler.display-name", "Ada");
    storage.setItem("beast-battler.reconnect-token", "token-1");
    const socket = new FakeSocket();
    mountLobby(storage, [], socket);

    socket.open();
    expect(JSON.parse(socket.sent[0] ?? "{}")).toMatchObject({
      type: "hello",
      displayName: "Ada",
      reconnectToken: "token-1",
    });
  });

  it("leaves the waiting match and closes the socket when returning to title", () => {
    const storage = new FakeStorage();
    storage.setItem("beast-battler.display-name", "Ada");
    const socket = new FakeSocket();
    let returned = 0;
    const root = new FakeRoot();
    mountOnlineLobby(root as unknown as HTMLElement, {
      startMatch: () => {},
      onReturnToTitle: () => {
        returned += 1;
      },
      createSocket: () => socket,
      storage,
    });

    socket.open();
    socket.receive({ type: "welcome", version: 1, reconnectToken: "token-1", displayName: "Ada" });
    socket.receive({ type: "match.waiting", match: MATCH });
    root.click("back-title");

    expect(JSON.parse(socket.sent.at(-1) ?? "{}")).toMatchObject({ type: "match.leave" });
    expect(socket.closeCalls).toBe(1);
    expect(returned).toBe(1);
  });
});
