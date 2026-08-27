import type { ArchetypeId } from "../cards/catalog";
import type {
  Element,
  GameCard,
  LandPermanent,
  MatchPhase,
  MatchResult,
  MonsterPermanent,
  PendingStackItem,
  PlayerId,
  SpellTarget,
} from "../rules/core";
import type { AttackDeclaration, BlockAssignment } from "../rules/combat";

export const PROTOCOL_VERSION = 1;

export type ReconnectToken = string;
export type MatchId = string;

export interface LobbyMatch {
  readonly id: MatchId;
  readonly name: string;
  readonly creatorName: string;
  readonly creatorArchetype: ArchetypeId;
}

export type MatchIntent =
  | Readonly<{ kind: "keep-hand" }>
  | Readonly<{ kind: "mulligan" }>
  | Readonly<{ kind: "advance-phase" }>
  | Readonly<{ kind: "play-land"; cardId: string }>
  | Readonly<{ kind: "summon"; cardId: string }>
  | Readonly<{ kind: "cast-spell"; cardId: string; target: SpellTarget | null; payWith: Element }>
  | Readonly<{ kind: "counterspell"; cardId: string; targetStackId: string; payWith: Element }>
  | Readonly<{ kind: "pass-response" }>
  | Readonly<{ kind: "fuse"; parentIds: readonly [string, string] }>
  | Readonly<{ kind: "upgrade-fusion"; fusionCardId: string; baseMonsterCardId: string }>
  | Readonly<{ kind: "declare-attackers"; attackerIds: readonly string[] }>
  | Readonly<{ kind: "assign-blockers"; blocks: readonly BlockAssignment[] }>
  | Readonly<{ kind: "hold-attack" }>
  | Readonly<{ kind: "discard"; cardIds: readonly string[] }>;

export type ClientMessage =
  | Readonly<{ type: "hello"; version: typeof PROTOCOL_VERSION; displayName?: string; reconnectToken?: ReconnectToken }>
  | Readonly<{ type: "lobby.list" }>
  | Readonly<{ type: "lobby.create"; name: string; archetype: ArchetypeId }>
  | Readonly<{ type: "lobby.join"; matchId: MatchId; archetype: ArchetypeId }>
  | Readonly<{ type: "match.intent"; intent: MatchIntent }>
  | Readonly<{ type: "match.rematch" }>
  | Readonly<{ type: "match.leave" }>;

export interface PrivatePlayerState {
  readonly id: PlayerId;
  readonly life: number;
  readonly hand: readonly GameCard[];
  readonly deckCount: number;
  readonly discardPile: readonly GameCard[];
  readonly extraDeck: readonly GameCard[];
  readonly lands: readonly LandPermanent[];
  readonly monsters: readonly MonsterPermanent[];
  readonly landPlayedThisTurn: boolean;
  readonly mulliganDecision: "pending" | "kept" | "mulliganed";
}

export interface PublicPlayerState {
  readonly id: PlayerId;
  readonly life: number;
  readonly handCount: number;
  readonly deckCount: number;
  readonly discardPile: readonly GameCard[];
  readonly extraDeck: readonly GameCard[];
  readonly lands: readonly LandPermanent[];
  readonly monsters: readonly MonsterPermanent[];
  readonly landPlayedThisTurn: boolean;
  readonly mulliganDecision: "pending" | "kept" | "mulliganed";
}

export interface MatchLogEntry {
  readonly actor: PlayerId;
  readonly intent: MatchIntent["kind"];
  readonly at: number;
}

export interface FilteredMatchState {
  readonly you: PrivatePlayerState;
  readonly opponent: PublicPlayerState;
  readonly firstPlayer: PlayerId;
  readonly activePlayer: PlayerId;
  readonly phase: MatchPhase;
  readonly turnNumber: number;
  readonly result: MatchResult | null;
  readonly stack: readonly PendingStackItem[];
  readonly responsePlayer: PlayerId | null;
  readonly combat: AttackDeclaration | null;
  readonly log: readonly MatchLogEntry[];
}

export type MatchEndReason = MatchResult["reason"] | "forfeit";

export type ServerMessage =
  | Readonly<{ type: "welcome"; version: typeof PROTOCOL_VERSION; reconnectToken: ReconnectToken; displayName: string }>
  | Readonly<{ type: "lobby.snapshot"; matches: readonly LobbyMatch[] }>
  | Readonly<{ type: "match.waiting"; match: LobbyMatch }>
  | Readonly<{ type: "match.started"; matchId: MatchId; playerId: PlayerId; opponentName: string }>
  | Readonly<{ type: "match.state"; matchId: MatchId; state: FilteredMatchState }>
  | Readonly<{ type: "match.paused"; matchId: MatchId; disconnectedPlayer: PlayerId; reconnectDeadline: number; remainingMs: number }>
  | Readonly<{ type: "match.resumed"; matchId: MatchId }>
  | Readonly<{ type: "match.ended"; matchId: MatchId; winner: PlayerId; loser: PlayerId; reason: MatchEndReason }>
  | Readonly<{ type: "match.rematch-status"; matchId: MatchId; acceptedBy: readonly PlayerId[] }>
  | Readonly<{ type: "error"; code: string; message: string }>;
