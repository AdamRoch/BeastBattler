import type { ArenaScene } from "../arena";
import type { OnlineMatchSession } from "../lobby/online-lobby";
import type {
  GameCard,
  FusionMonsterCard,
  MatchState,
  PlayerId,
  PlayerState,
  SpellTarget,
} from "../rules/core";
import type { SfxEngine } from "../sfx";
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type DecisionTimer,
  type FilteredMatchState,
  type MatchId,
  type MatchIntent,
  type ReconnectToken,
  type ServerMessage,
} from "../server/protocol";
import {
  mountMatch,
  type MatchController,
  type OnlineMatchAdapter,
  type OnlineMatchUpdate,
} from "./controller";

const RECONNECT_GRACE_MS = 60_000;
const RECONNECT_RETRY_MS = 1_000;

export interface WebSocketLike {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  send(data: string): void;
  close(): void;
}

export type { OnlineMatchSession };

export interface OnlineMatchDependencies {
  readonly arena: ArenaScene;
  readonly sfx?: SfxEngine;
  readonly createSocket?: (url: string) => WebSocketLike;
  readonly socketUrl?: string;
  readonly storage?: Storage;
  readonly now?: () => number;
  readonly schedule?: (callback: () => void, delayMs: number) => number;
  readonly cancel?: (timer: number) => void;
  readonly onReturnToLobby?: () => void;
}

export interface OnlineMatchController {
  readonly match: MatchController;
  leave(): void;
  dispose(): void;
}

/**
 * Starts a server-authoritative match. The lobby hands over its live socket
 * (PRD §14.5: one socket per client) at `match.started`; this client adopts
 * it without resending `hello` and owns it until dispose.
 */
export function startOnlineMatch(
  root: HTMLElement,
  session: OnlineMatchSession,
  deps: OnlineMatchDependencies,
): OnlineMatchController {
  const client = new OnlineMatchClient(session, deps);
  const status = document.createElement("aside");
  status.className = "online-match-status";
  status.hidden = true;
  status.setAttribute("role", "status");
  root.append(status);

  let statusText = "";
  let timers: readonly DecisionTimer[] = [];
  const renderStatus = () => {
    const timer = timers.find((candidate) => candidate.playerId === client.serverPlayerId()) ?? timers[0];
    const timerText = timer ? formatTimer(timer, client.serverPlayerId(), client.currentTime()) : "";
    status.hidden = statusText.length === 0 && timerText.length === 0;
    status.textContent = statusText || timerText;
    status.classList.toggle("is-countdown", timer?.stage === "countdown");
  };
  const timerTick = window.setInterval(renderStatus, 200);

  const unsubscribeStatus = client.subscribe((update) => {
    if (
      update.notice?.startsWith("Opponent disconnected") ||
      update.notice?.startsWith("Disconnected") ||
      update.notice?.includes("forfeited")
    ) {
      statusText = update.notice;
    } else if (update.notice === "Match resumed.") {
      statusText = "";
    }
    if (update.timers) timers = update.timers;
    renderStatus();
  });

  const match = mountMatch(root, deps.arena, {
    mode: "online",
    playerOneArchetype: session.playerArchetype,
    playerTwoArchetype: session.playerArchetype,
    sfx: deps.sfx,
    online: client,
  });
  client.connect();

  return {
    match,
    leave() {
      client.leave();
    },
    dispose() {
      unsubscribeStatus();
      window.clearInterval(timerTick);
      client.dispose();
      match.dispose();
      status.remove();
    },
  };
}

export class OnlineMatchClient implements OnlineMatchAdapter {
  private readonly listeners = new Set<(update: OnlineMatchUpdate) => void>();
  private readonly createSocket: (url: string) => WebSocketLike;
  private readonly storage: Storage | undefined;
  private readonly now: () => number;
  private readonly schedule: (callback: () => void, delayMs: number) => number;
  private readonly cancel: (timer: number) => void;
  private adoptedSocket: WebSocketLike | null;
  private socket: WebSocketLike | null = null;
  private reconnectTimer: number | null = null;
  private returnTimer: number | null = null;
  private reconnectStartedAt: number | null = null;
  private readonly reconnectingFromStoredToken: boolean;
  private reconnectToken: ReconnectToken | undefined;
  private matchId: MatchId | undefined;
  /** Server seat IDs address the RoomManager and must never select UI sides. */
  private serverPlayer: PlayerId | null = null;
  private state: MatchState | null = null;
  private disposed = false;

  constructor(
    private readonly session: OnlineMatchSession,
    private readonly deps: OnlineMatchDependencies,
  ) {
    this.createSocket = deps.createSocket ?? ((url) => new WebSocket(url));
    this.storage = deps.storage ?? safeSessionStorage();
    this.now = deps.now ?? Date.now;
    this.schedule = deps.schedule ?? ((callback, delayMs) => window.setTimeout(callback, delayMs));
    this.cancel = deps.cancel ?? ((timer) => window.clearTimeout(timer));
    const storedToken = this.storage?.getItem(tokenKey(session.matchId)) ?? undefined;
    this.reconnectToken = session.reconnectToken ?? storedToken;
    this.reconnectingFromStoredToken = !session.reconnectToken && Boolean(storedToken);
    this.adoptedSocket = session.socket;
    this.matchId = session.matchId;
    this.serverPlayer = session.playerId;
  }

  getState(): MatchState | null {
    return this.state;
  }

  /** Every filtered snapshot maps this browser to display player-1. */
  localPlayerId(): PlayerId {
    return "player-1";
  }

  serverPlayerId(): PlayerId | null {
    return this.serverPlayer;
  }

  currentTime(): number {
    return this.now();
  }

  subscribe(listener: (update: OnlineMatchUpdate) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  connect(): void {
    if (this.disposed) return;
    const adopted = this.adoptedSocket;
    if (adopted) {
      // The lobby already ran the hello/welcome handshake on this socket and
      // consumed the first `match.started`; just take over the message stream.
      this.adoptedSocket = null;
      this.socket = adopted;
      adopted.onmessage = (event) => this.receive(parseServerMessage(event.data));
      adopted.onclose = () => this.handleClose(adopted);
      adopted.onerror = () => {};
      this.publish({ notice: `Matched with ${this.session.opponentName}.` });
      return;
    }
    if (this.reconnectingFromStoredToken && this.reconnectStartedAt === null) {
      this.reconnectStartedAt = this.now();
      this.publish({ notice: reconnectNotice(this.reconnectStartedAt, this.now()) });
    }
    const socket = this.createSocket(this.deps.socketUrl ?? defaultSocketUrl());
    this.socket = socket;
    socket.onopen = () => {
      this.send({
        type: "hello",
        version: PROTOCOL_VERSION,
        displayName: this.session.displayName,
        reconnectToken: this.reconnectToken,
      });
    };
    socket.onmessage = (event) => this.receive(parseServerMessage(event.data));
    socket.onclose = () => this.handleClose(socket);
    socket.onerror = () => {};
  }

  sendIntent(intent: MatchIntent): void {
    this.send({ type: "match.intent", intent: fromDisplayIntent(intent, this.serverPlayer) });
  }

  requestRematch(): void {
    this.send({ type: "match.rematch" });
  }

  leave(): void {
    this.leaveMatch();
  }

  leaveMatch(): void {
    this.send({ type: "match.leave" });
    this.deps.onReturnToLobby?.();
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer !== null) this.cancel(this.reconnectTimer);
    if (this.returnTimer !== null) this.cancel(this.returnTimer);
    this.socket?.close();
    this.socket = null;
    this.listeners.clear();
  }

  private receive(message: ServerMessage | null): void {
    if (!message || this.disposed) return;
    switch (message.type) {
      case "welcome":
        this.reconnectToken = message.reconnectToken;
        this.storage?.setItem(tokenKey(this.matchId), message.reconnectToken);
        return;
      case "match.started":
        this.matchId = message.matchId;
        this.serverPlayer = message.playerId;
        this.storage?.setItem(tokenKey(message.matchId), this.reconnectToken ?? "");
        this.reconnectStartedAt = null;
        this.publish({ notice: `Matched with ${message.opponentName}.` });
        return;
      case "match.state":
        if (!this.acceptsMatch(message.matchId)) return;
        this.state = toLocalMatchState(message.state);
        this.publish({
          state: this.state,
          combat: remapCombat(message.state),
          timers: message.state.timers,
          fusionDeclined: message.state.fusionDeclined,
          notice: stateNotice(message.state),
        });
        return;
      case "match.paused":
        if (!this.acceptsMatch(message.matchId)) return;
        this.reconnectStartedAt = this.now();
        this.publish({ notice: pauseNotice(message, this.serverPlayer, this.now()) });
        this.schedulePauseCountdown(message);
        return;
      case "match.resumed":
        if (!this.acceptsMatch(message.matchId)) return;
        this.reconnectStartedAt = null;
        this.publish({ notice: "Match resumed." });
        return;
      case "match.ended":
        if (!this.acceptsMatch(message.matchId)) return;
        this.publish({ notice: endNotice(message, this.serverPlayer) });
        if (message.reason === "forfeit" && message.winner === this.serverPlayer) {
          this.returnTimer = this.schedule(() => this.deps.onReturnToLobby?.(), 1_800);
        }
        return;
      case "match.rematch-status":
        if (!this.acceptsMatch(message.matchId)) return;
        this.publish({
          notice: message.acceptedBy.includes(this.serverPlayer ?? "player-1")
            ? "Rematch accepted. Waiting for your opponent."
            : "Your opponent wants a rematch.",
        });
        return;
      case "error":
        this.publish({ notice: message.message });
        return;
      default:
        return;
    }
  }

  private handleClose(socket: WebSocketLike): void {
    if (this.disposed || socket !== this.socket) return;
    this.socket = null;
    this.reconnectStartedAt ??= this.now();
    this.publish({ notice: reconnectNotice(this.reconnectStartedAt, this.now()) });
    this.reconnectTimer = this.schedule(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_RETRY_MS);
  }

  private schedulePauseCountdown(message: Extract<ServerMessage, { type: "match.paused" }>): void {
    const update = () => {
      if (this.disposed || this.reconnectStartedAt === null) return;
      this.publish({ notice: pauseNotice(message, this.serverPlayer, this.now()) });
      const remaining = message.reconnectDeadline - this.now();
      if (remaining > 0) this.schedule(update, 1_000);
    };
    this.schedule(update, 1_000);
  }

  private acceptsMatch(matchId: MatchId): boolean {
    return !this.matchId || this.matchId === matchId;
  }

  private send(message: ClientMessage): void {
    if (!this.socket || this.socket.readyState !== 1) {
      this.publish({ notice: "Connection is restoring. Your action was not sent." });
      return;
    }
    this.socket.send(JSON.stringify(message));
  }

  private publish(update: OnlineMatchUpdate): void {
    for (const listener of this.listeners) listener(update);
  }
}

export function toLocalMatchState(state: FilteredMatchState): MatchState {
  const you = privatePlayer(state.you, "player-1");
  const opponent = publicPlayer(state.opponent, "player-2");
  return {
    players: [you, opponent],
    firstPlayer: localPlayerId(state.firstPlayer, state),
    activePlayer: localPlayerId(state.activePlayer, state),
    phase: state.phase,
    turnNumber: state.turnNumber,
    result: state.result && {
      winner: localPlayerId(state.result.winner, state),
      loser: localPlayerId(state.result.loser, state),
      reason: state.result.reason,
    },
    stack: state.stack.map((item) => ({
      ...item,
      controller: localPlayerId(item.controller, state),
      ...(item.kind === "spell" && item.target ? { target: remapTarget(item.target, state) } : {}),
    })) as MatchState["stack"],
    responsePlayer: state.responsePlayer ? localPlayerId(state.responsePlayer, state) : null,
  };
}

function privatePlayer(
  player: FilteredMatchState["you"],
  id: PlayerId,
): PlayerState {
  return {
    id,
    life: player.life,
    hand: player.hand,
    deck: cardBacks(player.deckCount, "your-deck"),
    discardPile: player.discardPile,
    extraDeck: fusionCards(player.extraDeck),
    lands: player.lands,
    monsters: player.monsters,
    landPlayedThisTurn: player.landPlayedThisTurn,
    mulliganDecision: player.mulliganDecision,
  };
}

function publicPlayer(
  player: FilteredMatchState["opponent"],
  id: PlayerId,
): PlayerState {
  return {
    id,
    life: player.life,
    hand: cardBacks(player.handCount, "opponent-hand"),
    deck: cardBacks(player.deckCount, "opponent-deck"),
    discardPile: player.discardPile,
    extraDeck: fusionCards(player.extraDeck),
    lands: player.lands,
    monsters: player.monsters,
    landPlayedThisTurn: player.landPlayedThisTurn,
    mulliganDecision: player.mulliganDecision,
  };
}

function cardBacks(count: number, prefix: string): readonly GameCard[] {
  return Array.from({ length: count }, (_, index) => ({
    instanceId: `${prefix}-${index}`,
    name: "Card back",
    kind: "land" as const,
    element: "earth" as const,
  }));
}

function fusionCards(cards: readonly GameCard[]): readonly FusionMonsterCard[] {
  return cards.filter(
    (card): card is FusionMonsterCard =>
      card.kind === "monster" && card.category === "fusion-monster",
  );
}

function localPlayerId(playerId: PlayerId, state: FilteredMatchState): PlayerId {
  return playerId === state.you.id ? "player-1" : "player-2";
}

function remotePlayerId(playerId: PlayerId, localPlayer: PlayerId | null): PlayerId {
  if (!localPlayer) return playerId;
  if (playerId === "player-1") return localPlayer;
  return localPlayer === "player-1" ? "player-2" : "player-1";
}

function remapTarget(target: SpellTarget, state: FilteredMatchState): SpellTarget {
  return { ...target, playerId: localPlayerId(target.playerId, state) };
}

function remapCombat(state: FilteredMatchState) {
  if (!state.combat) return null;
  return {
    ...state.combat,
    attackingPlayer: localPlayerId(state.combat.attackingPlayer, state),
    defendingPlayer: localPlayerId(state.combat.defendingPlayer, state),
  };
}

function fromDisplayIntent(intent: MatchIntent, playerId: PlayerId | null): MatchIntent {
  if (intent.kind !== "cast-spell" || !intent.target) return intent;
  return {
    ...intent,
    target: { ...intent.target, playerId: remotePlayerId(intent.target.playerId, playerId) },
  };
}

function stateNotice(state: FilteredMatchState): string {
  if (state.phase === "mulligan" && state.you.mulliganDecision === "pending") {
    return "Choose Keep or Mulligan to begin.";
  }
  if (state.responsePlayer === state.you.id) return "You have priority. Counter the pending action or pass.";
  if (state.activePlayer === state.you.id) return "Your turn.";
  return "Opponent's turn.";
}

function formatTimer(timer: DecisionTimer, localPlayerId: PlayerId | null, now: number): string {
  const seconds = Math.max(0, Math.ceil((timer.deadline - now) / 1_000));
  const owner = timer.playerId === localPlayerId ? "Your" : "Opponent's";
  return timer.stage === "countdown"
    ? `${owner} decision expires in ${seconds}s`
    : `${owner} decision countdown starts in ${seconds}s`;
}

function pauseNotice(
  message: Extract<ServerMessage, { type: "match.paused" }>,
  playerId: PlayerId | null,
  now = Date.now(),
): string {
  const seconds = Math.max(0, Math.ceil((message.reconnectDeadline - now) / 1_000));
  return message.disconnectedPlayer === playerId
    ? `Disconnected — rejoining in ${seconds}s`
    : `Opponent disconnected — waiting ${seconds}s`;
}

function reconnectNotice(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((RECONNECT_GRACE_MS - (now - startedAt)) / 1_000));
  return `Disconnected — rejoining in ${seconds}s`;
}

function endNotice(
  message: Extract<ServerMessage, { type: "match.ended" }>,
  playerId: PlayerId | null,
): string {
  if (message.reason === "forfeit" && message.winner === playerId) return "Opponent forfeited. You win.";
  return message.winner === playerId ? "You win." : "You lost.";
}

function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && "type" in parsed
      ? parsed as ServerMessage
      : null;
  } catch {
    return null;
  }
}

function defaultSocketUrl(): string {
  const url = new URL("/ws", window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function safeSessionStorage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function tokenKey(matchId: MatchId | undefined): string {
  return `beast-battler:reconnect:${matchId ?? "current"}`;
}
