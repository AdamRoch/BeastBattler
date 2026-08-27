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

export function phaseAdvanceButton(label: string): string {
  return `<button class="primary-action phase-advance-action" data-action="advance" data-phase-advance>${label}<span class="key-hint" aria-hidden="true">⏎</span><span class="sr-only"> Press Enter</span></button>`;
}

export function phaseAdvanceShortcutBlocked(state: PhaseAdvanceShortcutState): boolean {
  return state.targetingActive ||
    state.responseWindowOpen ||
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
    if (
      event.key !== "Enter" ||
      event.defaultPrevented ||
      isTextEntry(activeElement()) ||
      phaseAdvanceShortcutBlocked(state())
    ) {
      return;
    }

    const button = root.querySelector("[data-phase-advance]:not(:disabled)");
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
