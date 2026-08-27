import type {
  BaseMonsterCard,
  Element,
  FusionMonsterCard,
  PendingFusionSummon,
} from "../rules/core";

const FUSION_REVEAL_DURATION_MS = 2_500;

const ELEMENT_GLYPHS: Readonly<Record<Element, string>> = {
  fire: "▲",
  water: "≈",
  earth: "◆",
  air: "◇",
  lightning: "ϟ",
};

export interface FusionRevealSource {
  readonly name: string;
  readonly element: Element;
}

export interface FusionRevealData {
  readonly sources: readonly [FusionRevealSource, FusionRevealSource];
  readonly result: FusionMonsterCard;
}

export interface FusionRevealOverlay {
  show(data: FusionRevealData): void;
  dismiss(): void;
  dispose(): void;
}

/**
 * Keeps the reveal attached to the cards that were actually consumed and the
 * fusion card that actually resolved. It deliberately does not infer parents
 * from the result's recipe.
 */
export function fusionRevealFromEvent(
  sources: readonly [
    Pick<BaseMonsterCard, "name" | "element">,
    Pick<BaseMonsterCard, "name" | "element">,
  ],
  event: Pick<PendingFusionSummon, "card">,
): FusionRevealData {
  return {
    sources: [
      { name: sources[0].name, element: sources[0].element },
      { name: sources[1].name, element: sources[1].element },
    ],
    result: event.card,
  };
}

export function createFusionRevealOverlay(
  root: HTMLElement,
  portraitFor: (result: FusionMonsterCard) => string,
): FusionRevealOverlay {
  const overlay = document.createElement("aside");
  overlay.className = "fusion-reveal-overlay";
  overlay.hidden = true;
  overlay.setAttribute("aria-atomic", "true");
  overlay.setAttribute("aria-live", "assertive");
  overlay.setAttribute("data-testid", "fusion-reveal");
  root.append(overlay);

  let dismissTimer: number | undefined;
  let disposed = false;

  function dismiss(): void {
    window.clearTimeout(dismissTimer);
    dismissTimer = undefined;
    overlay.hidden = true;
    overlay.replaceChildren();
  }

  function handleClick(): void {
    dismiss();
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== "Enter" || overlay.hidden) {
      return;
    }
    event.preventDefault();
    dismiss();
  }

  overlay.addEventListener("click", handleClick);
  document.addEventListener("keydown", handleKeydown);

  return {
    show(data) {
      if (disposed) {
        return;
      }
      window.clearTimeout(dismissTimer);
      overlay.innerHTML = fusionRevealMarkup(data, portraitFor(data.result));
      overlay.hidden = false;
      overlay.classList.remove("is-revealing");
      void overlay.offsetWidth;
      overlay.classList.add("is-revealing");
      dismissTimer = window.setTimeout(dismiss, FUSION_REVEAL_DURATION_MS);
    },
    dismiss,
    dispose() {
      disposed = true;
      dismiss();
      overlay.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleKeydown);
      overlay.remove();
    },
  };
}

function fusionRevealMarkup(data: FusionRevealData, portrait: string): string {
  const [first, second] = data.sources;
  const result = data.result;
  return `
    <section class="fusion-reveal-card" role="status">
      <span class="fusion-reveal-eyebrow">FUSION COMPLETE</span>
      <h2>Fused ${escapeHtml(first.name)} with ${escapeHtml(second.name)}<br />— created ${escapeHtml(result.name)}!</h2>
      <div class="fusion-reveal-ritual" aria-label="${escapeHtml(first.element)} plus ${escapeHtml(second.element)} creates ${escapeHtml(result.name)}">
        ${elementIcon(first.element)}
        <span class="fusion-reveal-plus" aria-hidden="true">+</span>
        ${elementIcon(second.element)}
        <span class="fusion-reveal-arrow" aria-hidden="true">→</span>
      </div>
      <figure class="fusion-reveal-portrait">
        <img src="${portrait}" alt="${escapeHtml(result.name)} card art" />
        <figcaption>${escapeHtml(result.name)} <span>${result.attack} ATK · ${result.health} HP</span></figcaption>
      </figure>
      <small class="fusion-reveal-dismiss">Click anywhere or press Enter</small>
    </section>
  `;
}

function elementIcon(element: Element): string {
  const label = `${element[0].toUpperCase()}${element.slice(1)}`;
  return `<span class="fusion-reveal-element element-${element}" aria-label="${label}" title="${label}"><b aria-hidden="true">${ELEMENT_GLYPHS[element]}</b></span>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}
