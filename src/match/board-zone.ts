import {
  getPlayer,
  hasSummoningSickness,
  type MatchState,
  type PlayerId,
} from "../rules/core";

export function boardZoneMarkup(
  state: MatchState,
  owner: PlayerId,
  options: Readonly<{
    selectedAttackers?: ReadonlySet<string>;
    fusionPending?: boolean;
  }> = {},
): string {
  const monsters = getPlayer(state, owner).monsters;

  if (monsters.length === 0) {
    if (options.fusionPending) {
      return `<div class="board-transition" data-testid="${owner}-board-fusion-pending">Fusion pending</div>`;
    }
    return `<div class="empty-board" data-testid="${owner}-board-empty">No monsters deployed</div>`;
  }

  return monsters
    .map((monster) => {
      const selected = options.selectedAttackers?.has(monster.card.instanceId)
        ? " is-selected"
        : "";
      const sick = hasSummoningSickness(state, monster) ? " SICK" : "";
      const level = monster.card.level === 3 ? " ★3" : "";
      return `
        <button
          class="board-card${selected}"
          data-action="board-card"
          data-owner="${owner}"
          data-monster-id="${monster.card.instanceId}"
        >
          <span>${monster.card.name}${level}</span>
          <strong>${monster.card.attack}/${monster.card.health - monster.damage}</strong>
          <small>${sick || "READY"}</small>
        </button>
      `;
    })
    .join("");
}
