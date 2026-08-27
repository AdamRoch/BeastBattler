export interface PhaseAdvanceShortcutState {
  readonly targetingActive: boolean;
  readonly responseWindowOpen: boolean;
  readonly mulliganDecisionPending: boolean;
  readonly hotseatCurtainOpen: boolean;
}

interface PhaseAdvanceButton {
  click(): void;
}

interface PhaseAdvanceRoot {
  querySelector(selector: string): PhaseAdvanceButton | null;
}

interface KeyboardEventTarget {
  addEventListener(type: "keydown", listener: (event: KeyboardEvent) => void): void;
  removeEventListener(type: "keydown", listener: (event: KeyboardEvent) => void): void;
}

type ShortcutAction = "advance" | "attack";

export function phaseAdvanceButton(label: string, action: ShortcutAction = "advance"): string {
  return `<button class="primary-action phase-advance-action" data-action="${action}" data-phase-advance>${label}${enterHint()}</button>`;
}

export function responsePassButton(): string {
  return `<button class="primary-action response-action phase-advance-action" data-action="pass-response" data-response-pass>PASS${enterHint()}</button>`;
}

export function phaseAdvanceShortcutBlocked(state: PhaseAdvanceShortcutState): boolean {
  return state.targetingActive ||
    state.mulliganDecisionPending ||
    state.hotseatCurtainOpen;
}

export function installPhaseAdvanceShortcut(
  eventTarget: KeyboardEventTarget,
  root: PhaseAdvanceRoot,
  activeElement: () => Element | null,
  state: () => PhaseAdvanceShortcutState,
): () => void {
  const handleKeydown = (event: KeyboardEvent): void => {
    const shortcutState = state();
    if (
      event.key !== "Enter" ||
      event.defaultPrevented ||
      isTextEntry(activeElement()) ||
      phaseAdvanceShortcutBlocked(shortcutState)
    ) {
      return;
    }

    const button = root.querySelector(
      shortcutState.responseWindowOpen
        ? "[data-response-pass]:not(:disabled)"
        : "[data-phase-advance]:not(:disabled)",
    );
    if (!button) {
      return;
    }

    event.preventDefault();
    button.click();
  };

  eventTarget.addEventListener("keydown", handleKeydown);
  return () => eventTarget.removeEventListener("keydown", handleKeydown);
}

function isTextEntry(element: Element | null): boolean {
  if (!element) {
    return false;
  }
  return element.matches("input, textarea, select, [contenteditable='true']");
}

function enterHint(): string {
  return '<span class="key-hint" aria-hidden="true">⏎</span><span class="sr-only"> Press Enter</span>';
}
