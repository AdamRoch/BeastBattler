import type { Element, MonsterPermanent } from "../rules/core";

const ELEMENT_NAMES: Readonly<Record<Element, string>> = {
  fire: "Fire",
  water: "Water",
  earth: "Earth",
  air: "Air",
  lightning: "Lightning",
};

const UNIVERSAL_TRAMPLE_NOTE =
  "Trample: excess combat damage hits the defending player.";

const KEYWORD_NOTES = {
  burst: "Burst: On fusion or ★3 upgrade, deal 1 damage to the opponent.",
  slow: "Slow: Cannot attack the turn it enters play.",
} as const;

export interface MonsterTooltipContent {
  readonly name: string;
  readonly attack: number;
  readonly currentHealth: number;
  readonly maximumHealth: number;
  readonly elementLabel: string;
  readonly levelLabel: string;
  readonly statusLabel: "READY" | "SUMMONING SICK";
  readonly rules: readonly string[];
}

export interface MonsterTooltip {
  show(content: MonsterTooltipContent, clientX: number, clientY: number): void;
  hide(): void;
  dispose(): void;
}

export function monsterTooltipContent(
  monster: MonsterPermanent,
  summoningSick: boolean,
): MonsterTooltipContent {
  const { card } = monster;
  const elements = card.category === "base-monster"
    ? [card.element]
    : card.elements;
  const keywordNote = card.category === "fusion-monster" && card.keyword
    ? KEYWORD_NOTES[card.keyword]
    : null;

  return {
    name: card.name,
    attack: card.attack,
    currentHealth: Math.max(0, card.health - monster.damage),
    maximumHealth: card.health,
    elementLabel: elements.map((element) => ELEMENT_NAMES[element]).join(" / "),
    levelLabel: levelLabel(card.level),
    statusLabel: summoningSick ? "SUMMONING SICK" : "READY",
    rules: keywordNote
      ? [keywordNote, UNIVERSAL_TRAMPLE_NOTE]
      : [UNIVERSAL_TRAMPLE_NOTE],
  };
}

export function createMonsterTooltip(root: HTMLElement): MonsterTooltip {
  const tooltip = document.createElement("aside");
  tooltip.className = "monster-tooltip";
  tooltip.hidden = true;
  tooltip.setAttribute("role", "tooltip");
  tooltip.setAttribute("data-testid", "monster-tooltip");
  root.append(tooltip);

  let displayedKey = "";

  function hide(): void {
    tooltip.hidden = true;
    displayedKey = "";
  }

  return {
    show(content, clientX, clientY) {
      const contentKey = JSON.stringify(content);
      if (contentKey !== displayedKey) {
        renderTooltipContent(tooltip, content);
        displayedKey = contentKey;
      }

      tooltip.hidden = false;
      tooltip.style.left = `${clampTooltipPosition(
        clientX + 16,
        tooltip.offsetWidth,
        window.innerWidth,
      )}px`;
      tooltip.style.top = `${clampTooltipPosition(
        clientY + 16,
        tooltip.offsetHeight,
        window.innerHeight,
      )}px`;
    },
    hide,
    dispose() {
      tooltip.remove();
    },
  };
}

function levelLabel(level: 1 | 2 | 3): string {
  if (level === 1) {
    return "LEVEL 1 · BASE";
  }
  if (level === 2) {
    return "LEVEL 2 · FUSION";
  }
  return "★3 · FUSION";
}

function renderTooltipContent(
  tooltip: HTMLElement,
  content: MonsterTooltipContent,
): void {
  tooltip.classList.toggle("is-summoning-sick", content.statusLabel === "SUMMONING SICK");
  tooltip.replaceChildren(
    textElement("p", "monster-tooltip-level", content.levelLabel),
    textElement("h2", "monster-tooltip-name", content.name),
    tooltipStats(content),
    textElement("p", "monster-tooltip-element", content.elementLabel),
    textElement(
      "p",
      "monster-tooltip-status",
      content.statusLabel,
    ),
    ...content.rules.map((rule) => textElement("p", "monster-tooltip-rule", rule)),
  );
}

function tooltipStats(content: MonsterTooltipContent): HTMLElement {
  const stats = document.createElement("div");
  stats.className = "monster-tooltip-stats";
  stats.append(
    tooltipStat("ATK", String(content.attack)),
    tooltipStat("HP", `${content.currentHealth}/${content.maximumHealth}`),
  );
  return stats;
}

function tooltipStat(label: string, value: string): HTMLElement {
  const stat = document.createElement("span");
  stat.className = "monster-tooltip-stat";
  stat.append(
    textElement("small", "monster-tooltip-stat-label", label),
    textElement("strong", "monster-tooltip-stat-value", value),
  );
  return stat;
}

function textElement(
  tagName: keyof HTMLElementTagNameMap,
  className: string,
  text: string,
): HTMLElement {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function clampTooltipPosition(
  desired: number,
  tooltipSize: number,
  viewportSize: number,
): number {
  return Math.max(12, Math.min(desired, viewportSize - tooltipSize - 12));
}
