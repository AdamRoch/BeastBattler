import type {
  BaseMonsterCard,
  Element,
  FusionMonsterCard,
  MonsterPermanent,
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

export interface UpgradeRevealData {
  readonly result: FusionMonsterCard;
}

export interface FusionRevealOverlay {
  show(data: FusionRevealData): void;
  showUpgrade(data: UpgradeRevealData): void;
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

/**
 * Finds the fusion permanents that changed from level 2 to level 3. Matching
 * by permanent ID makes this safe when two monsters share a name.
 */
export function upgradeRevealsFromTransition(
  before: readonly MonsterPermanent[],
  after: readonly MonsterPermanent[],
): readonly UpgradeRevealData[] {
  const priorFusions = new Map(
    before
      .filter((monster) => monster.card.category === "fusion-monster")
      .map((monster) => [monster.card.instanceId, monster.card]),
  );
  const reveals: UpgradeRevealData[] = [];

  for (const monster of after) {
    if (monster.card.category !== "fusion-monster" || monster.card.level !== 3) {
      continue;
    }
    const previous = priorFusions.get(monster.card.instanceId);
    if (previous?.level === 2) {
      reveals.push({ result: monster.card });
    }
  }

  return reveals;
}

export function createFusionRevealOverlay(
  root: HTMLElement,
  portraitFor: (result: FusionMonsterCard) => string,
): FusionRevealOverlay {
  const overlay = document.createElement("aside");
  overlay.className = "fusion-reveal-overlay";
  overlay.hidden = true;
  // The stylesheet gives this overlay `display: grid`, which would otherwise
  // defeat the `hidden` attribute and leave a full-screen overlay capturing
  // every click. Keep the inline display in lockstep with visibility.
  overlay.style.display = "none";
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
    overlay.style.display = "none";
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

  function showMarkup(markup: string): void {
    if (disposed) {
      return;
    }
    window.clearTimeout(dismissTimer);
    overlay.innerHTML = markup;
    overlay.hidden = false;
    overlay.style.display = "grid";
    overlay.classList.remove("is-revealing");
    void overlay.offsetWidth;
    overlay.classList.add("is-revealing");
    dismissTimer = window.setTimeout(dismiss, FUSION_REVEAL_DURATION_MS);
  }

  return {
    show(data) {
      showMarkup(fusionRevealMarkup(data, portraitFor(data.result)));
    },
    showUpgrade(data) {
      showMarkup(upgradeRevealMarkup(data, portraitFor(data.result)));
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

function upgradeRevealMarkup(data: UpgradeRevealData, portrait: string): string {
  const result = data.result;
  return `
    <section class="fusion-reveal-card fusion-reveal-card-upgrade" role="status">
      <span class="fusion-reveal-eyebrow">LEVEL 3 UPGRADE</span>
      <h2>Level 3 Beast Created!</h2>
      <figure class="fusion-reveal-portrait">
        <img src="${portrait}" alt="${escapeHtml(result.name)} card art" />
        <figcaption>
          <strong>${escapeHtml(result.name)}</strong>
          <span class="fusion-reveal-stars">★★★</span>
          <span>${result.attack} ATK · ${result.health} HP</span>
        </figcaption>
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
