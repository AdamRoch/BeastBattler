import { findSpellDefinition } from "../cards/catalog";

export interface SpellTooltipContent {
  readonly name: string;
  readonly timingLabel: string;
  readonly rulesText: string;
}

export interface SpellTooltip {
  show(content: SpellTooltipContent, clientX: number, clientY: number): void;
  hide(): void;
  dispose(): void;
}

export function spellTooltipContent(spellId: string): SpellTooltipContent | null {
  const spell = findSpellDefinition(spellId);
  if (!spell) {
    return null;
  }

  return {
    name: spell.name,
    timingLabel: `${spell.timing.toUpperCase()} · COST ${spell.cost}`,
    rulesText: spell.rulesText,
  };
}

export function createSpellTooltip(root: HTMLElement): SpellTooltip {
  const tooltip = document.createElement("aside");
  tooltip.className = "spell-tooltip";
  tooltip.hidden = true;
  tooltip.setAttribute("role", "tooltip");
  tooltip.setAttribute("data-testid", "spell-tooltip");
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

function renderTooltipContent(
  tooltip: HTMLElement,
  content: SpellTooltipContent,
): void {
  tooltip.replaceChildren(
    textElement("p", "spell-tooltip-timing", content.timingLabel),
    textElement("h2", "spell-tooltip-name", content.name),
    textElement("p", "spell-tooltip-effect", content.rulesText),
  );
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
