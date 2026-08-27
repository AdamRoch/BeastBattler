import { describe, expect, it } from "vitest";
import {
  installPhaseAdvanceShortcut,
  phaseAdvanceButton,
  responsePassButton,
  type PhaseAdvanceShortcutState,
} from "./phase-advance-shortcut";

const clearState: PhaseAdvanceShortcutState = {
  targetingActive: false,
  responseWindowOpen: false,
  mulliganDecisionPending: false,
  hotseatCurtainOpen: false,
};

class FakeKeyTarget {
  private listener: ((event: KeyboardEvent) => void) | null = null;

  addEventListener(_type: "keydown", listener: (event: KeyboardEvent) => void): void {
    this.listener = listener;
  }

  removeEventListener(_type: "keydown", listener: (event: KeyboardEvent) => void): void {
    if (this.listener === listener) {
      this.listener = null;
    }
  }

  pressEnter(): boolean {
    const event = new Event("keydown", { cancelable: true }) as KeyboardEvent;
    Object.defineProperty(event, "key", { value: "Enter" });
    this.listener?.(event);
    return event.defaultPrevented;
  }
}

function textInput(): Element {
  return { matches: (selector: string) => selector.includes("input") } as Element;
}

describe("phase advance Enter shortcut", () => {
  it("marks phase buttons for the shortcut and shows the Enter hint", () => {
    expect(phaseAdvanceButton("TO COMBAT")).toContain('data-phase-advance');
    expect(phaseAdvanceButton("TO COMBAT")).toContain('class="key-hint" aria-hidden="true">⏎');
  });

  it("uses the same shortcut button for ATTACK ALL", () => {
    const button = phaseAdvanceButton("ATTACK ALL", "attack");

    expect(button).toContain('data-action="attack"');
    expect(button).toContain('data-phase-advance');
    expect(button).toContain('class="key-hint" aria-hidden="true">⏎');
  });

  it("marks PASS for Enter without marking COUNTERSPELL", () => {
    const button = responsePassButton();

    expect(button).toContain('data-action="pass-response"');
    expect(button).toContain("data-response-pass");
    expect(button).toContain('class="key-hint" aria-hidden="true">⏎');
  });

  it("clicks the rendered phase advance button", () => {
    const keys = new FakeKeyTarget();
    let clicks = 0;
    const detach = installPhaseAdvanceShortcut(
      keys,
      { querySelector: () => ({ click: () => { clicks += 1; } }) },
      () => null,
      () => clearState,
    );

    expect(keys.pressEnter()).toBe(true);
    expect(clicks).toBe(1);

    detach();
    keys.pressEnter();
    expect(clicks).toBe(1);
  });

  it.each([
    ["a targeting prompt", { ...clearState, targetingActive: true }],
    ["a mulligan decision", { ...clearState, mulliganDecisionPending: true }],
    ["a hotseat curtain", { ...clearState, hotseatCurtainOpen: true }],
  ])("does not click while %s is active", (_name, blockedState) => {
    const keys = new FakeKeyTarget();
    let clicks = 0;
    installPhaseAdvanceShortcut(
      keys,
      { querySelector: () => ({ click: () => { clicks += 1; } }) },
      () => null,
      () => blockedState,
    );

    expect(keys.pressEnter()).toBe(false);
    expect(clicks).toBe(0);
  });

  it("clicks PASS, never COUNTERSPELL, in a response window", () => {
    const keys = new FakeKeyTarget();
    let passClicks = 0;
    let counterClicks = 0;
    installPhaseAdvanceShortcut(
      keys,
      {
        querySelector: (selector) => selector.includes("data-response-pass")
          ? { click: () => { passClicks += 1; } }
          : { click: () => { counterClicks += 1; } },
      },
      () => null,
      () => ({ ...clearState, responseWindowOpen: true }),
    );

    expect(keys.pressEnter()).toBe(true);
    expect(passClicks).toBe(1);
    expect(counterClicks).toBe(0);
  });

  it("does not click while a text input has focus", () => {
    const keys = new FakeKeyTarget();
    let clicks = 0;
    installPhaseAdvanceShortcut(
      keys,
      { querySelector: () => ({ click: () => { clicks += 1; } }) },
      textInput,
      () => clearState,
    );

    expect(keys.pressEnter()).toBe(false);
    expect(clicks).toBe(0);
  });
});
