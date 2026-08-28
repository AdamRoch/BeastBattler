import {
  calculateCombatDamage,
  type CombatPlan,
} from "../rules/combat";
import {
  getPlayer,
  type MatchState,
  type PlayerId,
} from "../rules/core";

export const COMBAT_ENGAGE_BEAT_MS = 750;
export const COMBAT_IMPACT_BEAT_MS = 1_150;

export interface CombatPresentationBeat {
  readonly kind: "engage" | "impact";
  readonly attackerId: string;
  readonly blockerId: string | null;
  readonly attackingPlayer: PlayerId;
  readonly defendingPlayer: PlayerId;
  readonly matchup: string;
  readonly headline: string;
  readonly messages: readonly string[];
  readonly durationMs: number;
}

export interface PresentationTimer {
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(timer: number | undefined): void;
}

export class CombatPresentationQueue {
  private timer: number | undefined;
  private generation = 0;

  constructor(private readonly clock: PresentationTimer) {}

  play(
    beats: readonly CombatPresentationBeat[],
    onBeat: (beat: CombatPresentationBeat) => void,
    onComplete: () => void,
  ): void {
    this.clear();
    if (beats.length === 0) {
      onComplete();
      return;
    }

    const generation = this.generation;
    let index = 0;
    const advance = () => {
      if (generation !== this.generation) return;
      const beat = beats[index];
      if (!beat) {
        this.timer = undefined;
        onComplete();
        return;
      }
      onBeat(beat);
      index += 1;
      this.timer = this.clock.setTimeout(advance, beat.durationMs);
    };
    advance();
  }

  clear(): void {
    this.generation += 1;
    this.clock.clearTimeout(this.timer);
    this.timer = undefined;
  }
}

export function buildCombatPresentation(
  before: MatchState,
  plan: CombatPlan,
  viewer: PlayerId,
): readonly CombatPresentationBeat[] {
  const report = calculateCombatDamage(before, plan);
  const attackers = getPlayer(before, plan.attackingPlayer).monsters;
  const blockers = getPlayer(before, plan.defendingPlayer).monsters;
  const defendingLabel = plan.defendingPlayer === viewer ? "you" : "your opponent";

  return report.exchanges.flatMap((exchange) => {
    const attacker = attackers.find((monster) => monster.card.instanceId === exchange.attackerId);
    const blocker = exchange.blockerId
      ? blockers.find((monster) => monster.card.instanceId === exchange.blockerId)
      : undefined;
    if (!attacker) throw new Error(`Missing combat attacker ${exchange.attackerId}`);
    if (exchange.blockerId && !blocker) {
      throw new Error(`Missing combat blocker ${exchange.blockerId}`);
    }

    const matchup = blocker
      ? `${attacker.card.name} → ${blocker.card.name}`
      : `${attacker.card.name} → ${defendingLabel}`;
    const messages = blocker
      ? [
          `${blocker.card.name} took ${exchange.damageToBlocker} damage.`,
          `${attacker.card.name} took ${exchange.damageToAttacker} damage.`,
          ...(exchange.damageToDefendingPlayer > 0
            ? [`${exchange.damageToDefendingPlayer} trample damage hit ${defendingLabel}.`]
            : []),
        ]
      : [`${capitalize(defendingLabel)} took ${exchange.damageToDefendingPlayer} combat damage.`];

    return [
      {
        kind: "engage" as const,
        attackerId: exchange.attackerId,
        blockerId: exchange.blockerId,
        attackingPlayer: plan.attackingPlayer,
        defendingPlayer: plan.defendingPlayer,
        matchup,
        headline: blocker
          ? `${blocker.card.name} blocks ${attacker.card.name}.`
          : `${attacker.card.name} attacks ${defendingLabel} unblocked.`,
        messages: [],
        durationMs: COMBAT_ENGAGE_BEAT_MS,
      },
      {
        kind: "impact" as const,
        attackerId: exchange.attackerId,
        blockerId: exchange.blockerId,
        attackingPlayer: plan.attackingPlayer,
        defendingPlayer: plan.defendingPlayer,
        matchup,
        headline: "Combat damage",
        messages,
        durationMs: COMBAT_IMPACT_BEAT_MS,
      },
    ];
  });
}

export function combatPresentationMarkup(beat: CombatPresentationBeat): string {
  return `
    <aside class="combat-presentation combat-presentation-${beat.kind}" data-testid="combat-presentation" role="status">
      <span>${beat.kind === "engage" ? "BLOCK ASSIGNMENT" : "DAMAGE"}</span>
      <strong>${beat.matchup}</strong>
      <p>${beat.headline}</p>
      ${beat.messages.length ? `<ul>${beat.messages.map((message) => `<li>${message}</li>`).join("")}</ul>` : ""}
    </aside>
  `;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
