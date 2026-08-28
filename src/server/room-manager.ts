import {
  RulesError,
  advancePhase,
  createMatch,
  discardToHandLimit,
  getPlayer,
  keepHand,
  opponentOf,
  playLand,
  summonMonster,
  takeMulligan,
  type MatchState,
  type PlayerId,
} from "../rules/core";
import { assignBlockers, declareAttackers, resolveCombat } from "../rules/combat";
import { findFusionOptions, fuseMonsters, upgradeFusion } from "../rules/fusion";
import { castCounterspell, castSpell, passResponse } from "../rules/spells";
import { ARCHETYPES, assembleDeck, deriveExtraDeck, type ArchetypeId } from "../cards/catalog";
import type { ClientMessage, DecisionTimer, LobbyMatch, MatchEndReason, MatchId, MatchIntent, MatchLogEntry, ReconnectToken, ServerMessage } from "./protocol";
import { filterMatchState } from "./state-filter";

export const RECONNECT_GRACE_MS = 60_000;
export const TIMER_QUIET_MS = 5_000;
export const TIMER_COUNTDOWN_MS = 5_000;

export interface RoomConnection {
  send(message: ServerMessage): void;
}

interface PlayerSession {
  readonly token: ReconnectToken;
  displayName: string;
  connection: RoomConnection | null;
  matchId: MatchId | null;
}

interface MatchSeat {
  readonly playerId: PlayerId;
  readonly token: ReconnectToken;
  readonly displayName: string;
  readonly archetype: ArchetypeId;
  disconnectedAt: number | null;
}

interface Room {
  readonly id: MatchId;
  readonly name: string;
  seats: [MatchSeat, MatchSeat | null];
  state: MatchState | null;
  status: "waiting" | "active" | "finished";
  disconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectDeadline: number | null;
  combat: ReturnType<typeof declareAttackers> | null;
  log: MatchLogEntry[];
  rematchAccepted: Set<PlayerId>;
  timers: Map<PlayerId, ActiveDecisionTimer>;
  dismissedFusionKey: string | null;
}

type TimerDecision =
  | Readonly<{ playerId: PlayerId; kind: "mulligan"; intent: Extract<MatchIntent, { kind: "keep-hand" }> }>
  | Readonly<{ playerId: PlayerId; kind: "main"; intent: Extract<MatchIntent, { kind: "advance-phase" }> }>
  | Readonly<{ playerId: PlayerId; kind: "combat"; intent: Extract<MatchIntent, { kind: "hold-attack" }> }>
  | Readonly<{ playerId: PlayerId; kind: "blockers"; intent: Extract<MatchIntent, { kind: "assign-blockers" }> }>
  | Readonly<{ playerId: PlayerId; kind: "response"; intent: Extract<MatchIntent, { kind: "pass-response" }> }>
  | Readonly<{ playerId: PlayerId; kind: "fusion"; intent: Extract<MatchIntent, { kind: "dismiss-fusion" }> }>;

interface ActiveDecisionTimer extends DecisionTimer {
  readonly decision: TimerDecision;
  handle: ReturnType<typeof setTimeout> | null;
  remainingMs: number | null;
}

export interface RoomManagerOptions {
  readonly now?: () => number;
  readonly random?: () => number;
  readonly newId?: () => string;
  readonly schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly cancel?: (handle: ReturnType<typeof setTimeout>) => void;
}

export class RoomManager {
  private readonly sessions = new Map<ReconnectToken, PlayerSession>();
  private readonly rooms = new Map<MatchId, Room>();
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly newId: () => string;
  private readonly schedule: NonNullable<RoomManagerOptions["schedule"]>;
  private readonly cancel: NonNullable<RoomManagerOptions["cancel"]>;

  constructor(options: RoomManagerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.newId = options.newId ?? (() => globalThis.crypto.randomUUID());
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancel = options.cancel ?? ((handle) => clearTimeout(handle));
  }

  connect(connection: RoomConnection, hello: Extract<ClientMessage, { type: "hello" }>): ReconnectToken {
    let session = hello.reconnectToken ? this.sessions.get(hello.reconnectToken) : undefined;
    if (!session) {
      const displayName = cleanDisplayName(hello.displayName);
      if (!displayName) {
        connection.send({ type: "error", code: "display_name_required", message: "Choose a display name before entering the lobby." });
        return "";
      }
      session = { token: this.newUniqueId(), displayName, connection: null, matchId: null };
      this.sessions.set(session.token, session);
    } else if (hello.displayName) {
      session.displayName = cleanDisplayName(hello.displayName) ?? session.displayName;
    }

    session.connection = connection;
    connection.send({ type: "welcome", version: 1, reconnectToken: session.token, displayName: session.displayName });
    if (session.matchId) {
      const room = this.rooms.get(session.matchId);
      if (room?.status === "active") {
        this.reconnect(room, session);
        return session.token;
      }
    }
    this.sendLobby(session);
    return session.token;
  }

  disconnect(token: ReconnectToken, connection?: RoomConnection): void {
    const session = this.sessions.get(token);
    if (!session) return;
    if (connection && session.connection !== connection) return;
    session.connection = null;
    if (!session.matchId) return;
    const room = this.rooms.get(session.matchId);
    if (!room) {
      session.matchId = null;
      return;
    }
    if (room.status === "waiting") {
      this.closeWaitingRoom(room);
      return;
    }
    if (room.status !== "active") return;

    const seat = this.seatForToken(room, token);
    if (!seat || seat.disconnectedAt !== null) return;
    seat.disconnectedAt = this.now();
    room.reconnectDeadline = seat.disconnectedAt + RECONNECT_GRACE_MS;
    room.disconnectTimer = this.schedule(
      () => this.expireReconnect(room.id, seat.playerId, room.reconnectDeadline!),
      RECONNECT_GRACE_MS,
    );
    this.pauseDecisionTimers(room);
    this.sendToRoom(room, {
      type: "match.paused",
      matchId: room.id,
      disconnectedPlayer: seat.playerId,
      reconnectDeadline: room.reconnectDeadline,
      remainingMs: RECONNECT_GRACE_MS,
    });
  }

  receive(token: ReconnectToken, message: Exclude<ClientMessage, { type: "hello" }>): void {
    const session = this.sessions.get(token);
    if (!session) return;
    switch (message.type) {
      case "lobby.list": this.sendLobby(session); return;
      case "lobby.create": this.createMatch(session, message.name, message.archetype); return;
      case "lobby.join": this.joinMatch(session, message.matchId, message.archetype); return;
      case "match.intent": this.applyIntent(session, message.intent); return;
      case "match.rematch": this.acceptRematch(session); return;
      case "match.leave": this.leaveMatch(session); return;
    }
  }

  openMatches(): readonly LobbyMatch[] {
    return [...this.rooms.values()].filter((room) => room.status === "waiting").map((room) => this.lobbyMatch(room));
  }

  private createMatch(session: PlayerSession, name: string, archetype: ArchetypeId): void {
    if (session.matchId) return this.error(session, "already_in_match", "Leave your current match before creating another.");
    if (!isArchetype(archetype)) return this.error(session, "invalid_archetype", "Choose a valid archetype.");
    const cleanedName = cleanMatchName(name);
    if (!cleanedName) return this.error(session, "invalid_match_name", "A match name must be between 1 and 48 characters.");
    const room: Room = {
      id: this.newUniqueId(), name: cleanedName,
      seats: [{ playerId: "player-1", token: session.token, displayName: session.displayName, archetype, disconnectedAt: null }, null],
      state: null, status: "waiting", disconnectTimer: null, reconnectDeadline: null,
      combat: null, log: [], rematchAccepted: new Set(), timers: new Map(), dismissedFusionKey: null,
    };
    this.rooms.set(room.id, room);
    session.matchId = room.id;
    this.send(session, { type: "match.waiting", match: this.lobbyMatch(room) });
    this.broadcastLobby();
  }

  private joinMatch(session: PlayerSession, matchId: MatchId, archetype: ArchetypeId): void {
    if (session.matchId) return this.error(session, "already_in_match", "Leave your current match before joining another.");
    if (!isArchetype(archetype)) return this.error(session, "invalid_archetype", "Choose a valid archetype.");
    const room = this.rooms.get(matchId);
    if (!room || room.status !== "waiting" || room.seats[1]) return this.error(session, "match_unavailable", "That match is no longer available.");
    room.seats[1] = { playerId: "player-2", token: session.token, displayName: session.displayName, archetype, disconnectedAt: null };
    room.status = "active";
    room.state = this.newMatch(room);
    session.matchId = room.id;
    this.sendMatchStarted(room);
    this.resetDecisionTimers(room);
    this.sendMatchState(room);
    this.broadcastLobby();
  }

  private applyIntent(session: PlayerSession, intent: MatchIntent): void {
    const room = this.activeRoomFor(session);
    if (!room || !room.state) return;
    const seat = this.seatForToken(room, session.token);
    if (!seat) return;
    if (room.reconnectDeadline) return this.error(session, "match_paused", "Wait for your opponent to reconnect.");
    try {
      this.applyRoomIntent(room, seat.playerId, intent);
    } catch (error) {
      this.error(session, "illegal_intent", error instanceof RulesError ? error.message : "That action cannot be played now.");
    }
  }

  private runIntent(room: Room, playerId: PlayerId, intent: MatchIntent): MatchState {
    const state = room.state;
    if (!state) throw new RulesError("The match has not started");
    switch (intent.kind) {
      case "keep-hand": return keepHand(state, playerId);
      case "mulligan": {
        const player = getPlayer(state, playerId);
        return takeMulligan(state, playerId, shuffle([...player.hand, ...player.deck], this.random));
      }
      case "advance-phase": return advancePhase(state);
      case "play-land": return playLand(state, playerId, intent.cardId);
      case "summon": return summonMonster(state, playerId, intent.cardId);
      case "cast-spell": return castSpell(state, playerId, intent.cardId, intent.target, intent.payWith);
      case "counterspell": return castCounterspell(state, playerId, intent.cardId, intent.targetStackId, intent.payWith);
      case "pass-response": return passResponse(state, playerId);
      case "fuse": return fuseMonsters(state, playerId, intent.parentIds);
      case "upgrade-fusion": return upgradeFusion(state, playerId, intent.fusionCardId, intent.baseMonsterCardId);
      case "dismiss-fusion": {
        if (state.activePlayer !== playerId || state.phase !== "main" || state.responsePlayer || state.stack.length > 0) {
          throw new RulesError("Fusion can only be declined during your main phase");
        }
        if (fusionKey(state, playerId) !== intent.fusionKey) throw new RulesError("That fusion prompt is no longer available");
        room.dismissedFusionKey = intent.fusionKey;
        return state;
      }
      case "declare-attackers": room.combat = declareAttackers(state, playerId, intent.attackerIds); return state;
      case "assign-blockers": {
        if (!room.combat) throw new RulesError("There is no attack to block");
        const plan = assignBlockers(state, playerId, room.combat, intent.blocks);
        room.combat = null;
        return resolveCombat(state, plan);
      }
      case "hold-attack":
        if (state.activePlayer !== playerId || state.phase !== "combat") throw new RulesError("Only the active player may hold attacks");
        return advancePhase(state);
      case "discard": return discardToHandLimit(state, playerId, intent.cardIds);
    }
  }

  private applyRoomIntent(room: Room, playerId: PlayerId, intent: MatchIntent): void {
    room.state = this.runIntent(room, playerId, intent);
    if (intent.kind !== "dismiss-fusion") room.dismissedFusionKey = null;
    room.log.push({ actor: playerId, intent: intent.kind, at: this.now() });
    this.resetDecisionTimers(room);
    this.sendMatchState(room);
    if (room.state.result) this.finishMatch(room, room.state.result.winner, room.state.result.loser, room.state.result.reason);
  }

  private resetDecisionTimers(room: Room): void {
    this.cancelDecisionTimers(room);
    if (!room.state || room.status !== "active" || room.reconnectDeadline) return;
    for (const decision of this.timerDecisions(room)) {
      this.startDecisionTimer(room, decision, "quiet", TIMER_QUIET_MS);
    }
  }

  private timerDecisions(room: Room): readonly TimerDecision[] {
    const state = room.state;
    if (!state || state.result) return [];
    if (state.phase === "mulligan") {
      return state.players
        .filter((player) => player.mulliganDecision === "pending")
        .map((player) => ({ playerId: player.id, kind: "mulligan", intent: { kind: "keep-hand" } }));
    }
    if (room.combat) {
      return [{ playerId: room.combat.defendingPlayer, kind: "blockers", intent: { kind: "assign-blockers", blocks: [] } }];
    }
    if (state.responsePlayer) {
      return [{ playerId: state.responsePlayer, kind: "response", intent: { kind: "pass-response" } }];
    }
    if (state.phase === "main") {
      const key = fusionKey(state, state.activePlayer);
      if (key && key !== room.dismissedFusionKey) {
        return [{ playerId: state.activePlayer, kind: "fusion", intent: { kind: "dismiss-fusion", fusionKey: key } }];
      }
      return [{ playerId: state.activePlayer, kind: "main", intent: { kind: "advance-phase" } }];
    }
    if (state.phase === "combat") {
      return [{ playerId: state.activePlayer, kind: "combat", intent: { kind: "hold-attack" } }];
    }
    return [];
  }

  private startDecisionTimer(
    room: Room,
    decision: TimerDecision,
    stage: DecisionTimer["stage"],
    delayMs: number,
  ): void {
    const timer: ActiveDecisionTimer = {
      playerId: decision.playerId,
      decision,
      stage,
      deadline: this.now() + delayMs,
      handle: null,
      remainingMs: null,
    };
    room.timers.set(decision.playerId, timer);
    timer.handle = this.schedule(() => this.advanceDecisionTimer(room, timer), delayMs);
  }

  private advanceDecisionTimer(room: Room, timer: ActiveDecisionTimer): void {
    if (room.status !== "active" || room.reconnectDeadline || room.timers.get(timer.playerId) !== timer) return;
    if (timer.stage === "quiet") {
      this.startDecisionTimer(room, timer.decision, "countdown", TIMER_COUNTDOWN_MS);
      this.sendMatchState(room);
      return;
    }
    room.timers.delete(timer.playerId);
    try {
      if (timer.decision.kind === "main") {
        this.applyRoomIntent(room, timer.playerId, { kind: "advance-phase" });
        this.applyRoomIntent(room, timer.playerId, { kind: "hold-attack" });
      } else {
        this.applyRoomIntent(room, timer.playerId, timer.decision.intent);
      }
    } catch {
      this.resetDecisionTimers(room);
      this.sendMatchState(room);
    }
  }

  private pauseDecisionTimers(room: Room): void {
    for (const timer of room.timers.values()) {
      if (timer.handle !== null) this.cancel(timer.handle);
      timer.handle = null;
      timer.remainingMs = Math.max(0, timer.deadline - this.now());
    }
  }

  private resumeDecisionTimers(room: Room): void {
    const paused = [...room.timers.values()];
    room.timers.clear();
    for (const timer of paused) {
      this.startDecisionTimer(
        room,
        timer.decision,
        timer.stage,
        timer.remainingMs ?? (timer.stage === "quiet" ? TIMER_QUIET_MS : TIMER_COUNTDOWN_MS),
      );
    }
  }

  private cancelDecisionTimers(room: Room): void {
    for (const timer of room.timers.values()) if (timer.handle !== null) this.cancel(timer.handle);
    room.timers.clear();
  }

  private timerSnapshots(room: Room): readonly DecisionTimer[] {
    return [...room.timers.values()].map(({ playerId, stage, deadline }) => ({ playerId, stage, deadline }));
  }

  private acceptRematch(session: PlayerSession): void {
    const room = session.matchId ? this.rooms.get(session.matchId) : undefined;
    if (!room || room.status !== "finished" || !room.state?.result) return this.error(session, "rematch_unavailable", "A rematch is available only after a completed match.");
    if (!this.bothConnected(room)) return this.error(session, "opponent_disconnected", "Both players must be connected to rematch.");
    const seat = this.seatForToken(room, session.token);
    if (!seat) return;
    room.rematchAccepted.add(seat.playerId);
    this.sendToRoom(room, { type: "match.rematch-status", matchId: room.id, acceptedBy: [...room.rematchAccepted] });
    if (room.rematchAccepted.size === 2) {
      room.state = this.newMatch(room);
      room.status = "active";
      room.combat = null;
      room.log = [];
      room.rematchAccepted.clear();
      room.dismissedFusionKey = null;
      this.sendMatchStarted(room);
      this.resetDecisionTimers(room);
      this.sendMatchState(room);
    }
  }

  private leaveMatch(session: PlayerSession): void {
    if (!session.matchId) return this.sendLobby(session);
    const room = this.rooms.get(session.matchId);
    if (!room) {
      session.matchId = null;
      this.sendLobby(session);
      return;
    }
    if (room.status === "waiting") return this.closeWaitingRoom(room);
    const seat = this.seatForToken(room, session.token);
    if (seat) this.finishMatch(room, opponentOf(seat.playerId), seat.playerId, "forfeit");
  }

  private reconnect(room: Room, session: PlayerSession): void {
    const seat = this.seatForToken(room, session.token);
    if (!seat) return;
    if (seat.disconnectedAt !== null) {
      seat.disconnectedAt = null;
      if (room.disconnectTimer !== null) this.cancel(room.disconnectTimer);
      room.disconnectTimer = null;
      room.reconnectDeadline = null;
      this.sendToRoom(room, { type: "match.resumed", matchId: room.id });
      this.resumeDecisionTimers(room);
    }
    this.sendMatchStarted(room);
    this.sendMatchState(room);
  }

  private expireReconnect(matchId: MatchId, disconnectedPlayer: PlayerId, deadline: number): void {
    const room = this.rooms.get(matchId);
    if (!room || room.status !== "active" || room.reconnectDeadline !== deadline) return;
    const seat = room.seats.find((candidate) => candidate?.playerId === disconnectedPlayer);
    if (!seat || seat.disconnectedAt === null) return;
    this.finishMatch(room, opponentOf(disconnectedPlayer), disconnectedPlayer, "forfeit");
  }

  private finishMatch(room: Room, winner: PlayerId, loser: PlayerId, reason: MatchEndReason): void {
    if (room.disconnectTimer !== null) this.cancel(room.disconnectTimer);
    this.cancelDecisionTimers(room);
    room.disconnectTimer = null;
    room.reconnectDeadline = null;
    room.status = "finished";
    room.combat = null;
    this.sendToRoom(room, { type: "match.ended", matchId: room.id, winner, loser, reason });
    if (reason === "forfeit") {
      this.rooms.delete(room.id);
      for (const seat of room.seats) {
        if (!seat) continue;
        const session = this.sessions.get(seat.token);
        if (session?.matchId === room.id) session.matchId = null;
      }
      this.broadcastLobby();
    }
  }

  private closeWaitingRoom(room: Room): void {
    this.rooms.delete(room.id);
    for (const seat of room.seats) {
      if (!seat) continue;
      const session = this.sessions.get(seat.token);
      if (session?.matchId === room.id) session.matchId = null;
    }
    this.broadcastLobby();
  }

  private newMatch(room: Room): MatchState {
    const [first, second] = room.seats;
    if (!second) throw new Error("A match needs two players");
    return createMatch({
      playerOneDeck: shuffle(assembleDeck(first.archetype), this.random),
      playerTwoDeck: shuffle(assembleDeck(second.archetype), this.random),
      playerOneExtraDeck: deriveExtraDeck(first.archetype),
      playerTwoExtraDeck: deriveExtraDeck(second.archetype),
    });
  }

  private activeRoomFor(session: PlayerSession): Room | undefined {
    const room = session.matchId ? this.rooms.get(session.matchId) : undefined;
    if (!room || room.status !== "active") {
      this.error(session, "match_not_active", "Join a match before sending game actions.");
      return undefined;
    }
    return room;
  }

  private sendMatchStarted(room: Room): void {
    for (const seat of room.seats) {
      if (!seat) continue;
      const opponent = this.opponentSeat(room, seat.playerId);
      this.sendByToken(seat.token, {
        type: "match.started",
        matchId: room.id,
        playerId: seat.playerId,
        opponentName: opponent.displayName,
        playerArchetype: seat.archetype,
        opponentArchetype: opponent.archetype,
      });
    }
  }

  private sendMatchState(room: Room): void {
    if (!room.state) return;
    for (const seat of room.seats) {
      if (!seat) continue;
      this.sendByToken(seat.token, {
        type: "match.state",
        matchId: room.id,
        state: filterMatchState(
          room.state,
          seat.playerId,
          room.log,
          room.combat,
          this.timerSnapshots(room),
          room.dismissedFusionKey !== null && room.state.activePlayer === seat.playerId,
        ),
      });
    }
  }

  private sendLobby(session: PlayerSession): void {
    this.send(session, { type: "lobby.snapshot", matches: this.openMatches() });
  }

  private broadcastLobby(): void {
    for (const session of this.sessions.values()) if (!session.matchId && session.connection) this.sendLobby(session);
  }

  private sendToRoom(room: Room, message: ServerMessage): void {
    for (const seat of room.seats) if (seat) this.sendByToken(seat.token, message);
  }

  private sendByToken(token: ReconnectToken, message: ServerMessage): void {
    const session = this.sessions.get(token);
    if (session) this.send(session, message);
  }

  private send(session: PlayerSession, message: ServerMessage): void {
    session.connection?.send(message);
  }

  private error(session: PlayerSession, code: string, message: string): void {
    this.send(session, { type: "error", code, message });
  }

  private seatForToken(room: Room, token: ReconnectToken): MatchSeat | undefined {
    return room.seats.find((seat) => seat?.token === token) ?? undefined;
  }

  private opponentSeat(room: Room, playerId: PlayerId): MatchSeat {
    const opponent = room.seats.find((seat) => seat?.playerId === opponentOf(playerId));
    if (!opponent) throw new Error("A started room must have an opponent");
    return opponent;
  }

  private bothConnected(room: Room): boolean {
    return room.seats.every((seat) => seat && this.sessions.get(seat.token)?.connection);
  }

  private lobbyMatch(room: Room): LobbyMatch {
    const creator = room.seats[0];
    return { id: room.id, name: room.name, creatorName: creator.displayName, creatorArchetype: creator.archetype };
  }

  private newUniqueId(): string {
    let id = this.newId();
    while (this.rooms.has(id) || this.sessions.has(id)) id = this.newId();
    return id;
  }
}

function isArchetype(value: string): value is ArchetypeId {
  return ARCHETYPES.some((archetype) => archetype.id === value);
}

function cleanDisplayName(value: string | undefined): string | null {
  const cleaned = value?.trim().replace(/\s+/g, " ");
  return cleaned && cleaned.length <= 24 ? cleaned : null;
}

function cleanMatchName(value: string): string | null {
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned.length >= 1 && cleaned.length <= 48 ? cleaned : null;
}

function shuffle<T>(cards: readonly T[], random: () => number): T[] {
  const shuffled = [...cards];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function fusionKey(state: MatchState, playerId: PlayerId): string {
  return findFusionOptions(state, playerId)
    .map((option) => option.parentIds.join("+"))
    .join("|");
}
