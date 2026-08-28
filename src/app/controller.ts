import type { ArenaScene } from "../arena";
import {
  ARCHETYPES,
  deriveExtraDeck,
  type ArchetypeId,
} from "../cards/catalog";
import { mountMatch, type MatchController } from "../match/controller";
import {
  mountOnlineLobby,
  type OnlineLobbyController,
  type OnlineMatchSession,
} from "../lobby/online-lobby";
import {
  resultMessageFor,
  resultMessageMarkup,
} from "../match/result-message";
import type { MatchResult } from "../rules/core";
import type { SfxEngine } from "../sfx";
import {
  continueHotseatDeckSelection,
  continueHotseatResultHandoff,
  createInitialAppState,
  handoffHotseatResult,
  isConfiguredMatch,
  rematch,
  returnToTitle,
  selectArchetype,
  selectMode,
  showOnlineLobby,
  showModeSelect,
  showResult,
  type AppState,
  type GameMode,
} from "./state";

export interface AppController {
  getState(): AppState;
  returnToOnlineLobby(): void;
  dispose(): void;
}

export interface AppControllerOptions {
  readonly sfx?: SfxEngine;
  readonly startOnlineMatch?: (session: OnlineMatchSession) => void;
}

export function mountApp(
  root: HTMLElement,
  arena: ArenaScene,
  options: AppControllerOptions = {},
): AppController {
  const screens = document.createElement("div");
  screens.className = "screen-layer";
  root.append(screens);

  let state = createInitialAppState();
  let matchController: MatchController | null = null;
  let onlineLobby: OnlineLobbyController | null = null;
  let renderedScreen = state.screen;

  function render(): void {
    if (state.screen === "deck-handoff" && renderedScreen !== state.screen) {
      options.sfx?.play("curtain");
    }
    renderedScreen = state.screen;
    root.dataset.screen = state.screen;
    if (state.mode) {
      root.dataset.mode = state.mode;
    } else {
      delete root.dataset.mode;
    }

    if (state.screen === "match") {
      disposeOnlineLobby();
      screens.className = "screen-layer is-hidden";
      screens.innerHTML = "";
      startMatch();
      return;
    }

    screens.className = "screen-layer";
    if (state.screen === "online-lobby") {
      disposeMatch();
      if (!onlineLobby) {
        screens.innerHTML = "";
        onlineLobby = mountOnlineLobby(screens, {
          onReturnToTitle() {
            onlineLobby = null;
            state = returnToTitle();
            render();
          },
          startMatch(session) {
            onlineLobby = null;
            if (options.startOnlineMatch) {
              screens.className = "screen-layer is-hidden";
              screens.innerHTML = "";
              options.startOnlineMatch(session);
              return;
            }
            screens.innerHTML = onlineMatchPlaceholder(session);
          },
        });
      }
      return;
    }
    disposeOnlineLobby();
    if (state.screen !== "result") {
      disposeMatch();
    }

    switch (state.screen) {
      case "title":
        screens.innerHTML = titleScreen();
        return;
      case "mode-select":
        screens.innerHTML = modeScreen();
        return;
      case "deck-select":
        screens.innerHTML = deckScreen(state);
        return;
      case "deck-handoff":
        screens.innerHTML = deckHandoffScreen();
        return;
      case "result-handoff":
        screens.innerHTML = resultHandoffScreen(state);
        return;
      case "result":
        screens.innerHTML = resultScreen(state);
        return;
    }
  }

  function startMatch(): void {
    if (matchController || !isConfiguredMatch(state)) {
      return;
    }
    matchController = mountMatch(root, arena, {
      mode: state.mode,
      playerOneArchetype: state.playerOneArchetype,
      playerTwoArchetype: state.playerTwoArchetype,
      onComplete: handleMatchComplete,
      sfx: options.sfx,
    });
  }

  function handleMatchComplete(result: MatchResult): void {
    state = showResult(state, result);
    render();
  }

  function disposeMatch(): void {
    matchController?.dispose();
    matchController = null;
  }

  function handleClick(event: Event): void {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLElement>("[data-screen-action]");
    if (!button) {
      return;
    }

    switch (button.dataset.screenAction) {
      case "start":
        state = showModeSelect(state);
        break;
      case "select-mode": {
        const mode = button.dataset.mode;
        if (!isGameMode(mode)) {
          return;
        }
        state = selectMode(state, mode);
        break;
      }
      case "online":
        state = showOnlineLobby(state);
        break;
      case "select-deck": {
        const archetype = button.dataset.archetype;
        if (!isArchetypeId(archetype)) {
          return;
        }
        state = selectArchetype(state, archetype);
        break;
      }
      case "continue-handoff":
        state = continueHotseatDeckSelection(state);
        break;
      case "continue-result-handoff":
        state = continueHotseatResultHandoff(state);
        break;
      case "handoff-result":
        state = handoffHotseatResult(state);
        break;
      case "rematch":
        disposeMatch();
        state = rematch(state);
        break;
      case "menu":
        disposeMatch();
        state = returnToTitle();
        break;
      case "back-title":
        state = returnToTitle();
        break;
      case "back-mode":
        state = showModeSelect(state);
        break;
      default:
        return;
    }
    render();
  }

  screens.addEventListener("click", handleClick);
  render();

  return {
    getState: () => state,
    returnToOnlineLobby() {
      state = showOnlineLobby(state);
      render();
    },
    dispose() {
      disposeMatch();
      disposeOnlineLobby();
      screens.removeEventListener("click", handleClick);
      screens.remove();
      delete root.dataset.screen;
      delete root.dataset.mode;
    },
  };

  function disposeOnlineLobby(): void {
    onlineLobby?.dispose();
    onlineLobby = null;
  }
}

function titleScreen(): string {
  return `
    <main class="flow-screen title-screen" data-testid="title-screen">
      <div class="title-mark" data-placeholder-logo aria-label="Beast Battler placeholder logo">
        <span>BEAST</span>
        <strong>BATTLER</strong>
      </div>
      <p class="title-tagline">Fuse monsters. Break defenses. Take the arena.</p>
      <button class="flow-primary" data-screen-action="start">ENTER THE ARENA</button>
      <small class="build-label">PROTOTYPE BUILD</small>
    </main>
  `;
}

function modeScreen(): string {
  return `
    <main class="flow-screen selection-screen" data-testid="mode-screen">
      ${screenHeading("CHOOSE MODE", "Who is stepping into the arena?")}
      <div class="mode-grid">
        <button class="mode-card" data-screen-action="select-mode" data-mode="ai">
          <span class="mode-icon" aria-hidden="true">⌁</span>
          <strong>VS AI</strong>
          <small>Battle the scripted opponent</small>
        </button>
        <button class="mode-card" data-screen-action="select-mode" data-mode="hotseat">
          <span class="mode-icon" aria-hidden="true">Ⅱ</span>
          <strong>HOTSEAT</strong>
          <small>Two players, one device</small>
        </button>
        <button class="mode-card mode-card-online" data-screen-action="online">
          <span class="mode-icon" aria-hidden="true">◌</span>
          <strong>ONLINE</strong>
          <small>Find a live match</small>
        </button>
      </div>
      <button class="flow-back" data-screen-action="back-title">BACK</button>
    </main>
  `;
}

function onlineMatchPlaceholder(session: OnlineMatchSession): string {
  return `
    <main class="flow-screen online-screen waiting-screen" data-testid="online-match-placeholder">
      <section class="online-panel waiting-panel">
        <span class="screen-kicker">MATCH STARTED</span>
        <h1>OPPONENT FOUND</h1>
        <p>Connected to ${session.opponentName}. The online match controller takes over here.</p>
      </section>
    </main>
  `;
}

function deckScreen(state: AppState): string {
  const player = state.selectingPlayer ?? 1;
  const title = state.mode === "hotseat"
    ? `PLAYER ${player} · CHOOSE DECK`
    : "CHOOSE YOUR DECK";
  const subtitle = state.mode === "ai"
    ? "Pick one of the ten two-element archetypes."
    : "Your choice locks as soon as you select it.";
  return `
    <main class="flow-screen deck-screen" data-testid="deck-screen">
      ${screenHeading(title, subtitle)}
      <div class="archetype-grid">
        ${ARCHETYPES.map(archetypeCard).join("")}
      </div>
      <button class="flow-back" data-screen-action="back-mode">BACK TO MODES</button>
    </main>
  `;
}

function archetypeCard(
  archetype: (typeof ARCHETYPES)[number],
): string {
  const fusionNames = deriveExtraDeck(archetype.id)
    .map((card) => card.name.replace(" Beast", ""))
    .join(" · ");
  const [first, second] = archetype.elements;
  return `
    <button
      class="archetype-card"
      data-screen-action="select-deck"
      data-archetype="${archetype.id}"
      aria-label="Choose ${elementName(first)} and ${elementName(second)}"
    >
      <span class="element-pair">
        <i class="element-orb element-${first}"></i>
        <i class="element-link"></i>
        <i class="element-orb element-${second}"></i>
      </span>
      <strong>${elementName(first)} + ${elementName(second)}</strong>
      <small>${fusionNames}</small>
    </button>
  `;
}

function deckHandoffScreen(): string {
  return `
    <main class="flow-screen handoff-screen" data-testid="deck-handoff-screen">
      <span class="handoff-lock" aria-hidden="true">◆</span>
      <span class="screen-kicker">PLAYER 1 LOCKED IN</span>
      <h1>Pass the device</h1>
      <p>Player 2, press ready when Player 1 can no longer see the screen.</p>
      <button class="flow-primary" data-screen-action="continue-handoff">PLAYER 2 READY</button>
    </main>
  `;
}

export function resultScreen(state: AppState): string {
  if (!state.result || !state.mode || !state.resultViewingPlayer) {
    throw new Error("A result screen requires a completed match");
  }
  const playerOneWon = state.result.winner === "player-1";
  const heading = state.mode === "ai"
    ? playerOneWon ? "VICTORY" : "DEFEAT"
    : `PLAYER ${playerOneWon ? 1 : 2} WINS`;
  const message = resultMessageFor(state.result, state.resultViewingPlayer);
  const handoff = state.mode === "hotseat" &&
    state.resultViewingPlayer === state.result.winner
    ? `<button class="flow-secondary" data-screen-action="handoff-result">PASS TO PLAYER ${state.result.loser === "player-1" ? 1 : 2}</button>`
    : "";
  return `
    <main class="flow-screen result-screen" data-testid="result-screen">
      <span class="screen-kicker">MATCH COMPLETE</span>
      <h1>${heading}</h1>
      ${resultMessageMarkup(message)}
      <p class="result-reason">${message.reason}</p>
      <div class="result-actions">
        ${handoff}
        <button class="flow-primary" data-screen-action="rematch">REMATCH</button>
        <button class="flow-secondary" data-screen-action="menu">MAIN MENU</button>
      </div>
    </main>
  `;
}

export function resultHandoffScreen(state: AppState): string {
  if (!state.result || !state.resultViewingPlayer) {
    throw new Error("A result handoff requires a completed match");
  }
  const playerNumber = state.resultViewingPlayer === "player-1" ? 1 : 2;
  return `
    <main class="flow-screen handoff-screen" data-testid="result-handoff-screen">
      <span class="handoff-lock" aria-hidden="true">◆</span>
      <span class="screen-kicker">MATCH COMPLETE</span>
      <h1>Pass the device</h1>
      <p>Player ${playerNumber}, press ready when the other player can no longer see the screen.</p>
      <button class="flow-primary" data-screen-action="continue-result-handoff">I'M PLAYER ${playerNumber}</button>
    </main>
  `;
}

function screenHeading(title: string, subtitle: string): string {
  return `
    <header class="screen-heading">
      <span class="screen-kicker">BEAST BATTLER</span>
      <h1>${title}</h1>
      <p>${subtitle}</p>
    </header>
  `;
}

function elementName(element: string): string {
  return `${element.charAt(0).toUpperCase()}${element.slice(1)}`;
}

function isGameMode(value: string | undefined): value is GameMode {
  return value === "ai" || value === "hotseat";
}

function isArchetypeId(value: string | undefined): value is ArchetypeId {
  return ARCHETYPES.some((archetype) => archetype.id === value);
}
