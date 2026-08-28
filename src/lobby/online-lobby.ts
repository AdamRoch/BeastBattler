import {
  ARCHETYPES,
  deriveExtraDeck,
  type ArchetypeId,
} from "../cards/catalog";
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type LobbyMatch,
  type MatchId,
  type ReconnectToken,
  type ServerMessage,
} from "../server/protocol";
import type { PlayerId } from "../rules/core";

const DISPLAY_NAME_KEY = "beast-battler.display-name";
const RECONNECT_TOKEN_KEY = "beast-battler.reconnect-token";

type LobbyView = "identity" | "lobby" | "create" | "join" | "waiting" | "failed";

interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "close" | "error" | "message", listener: EventListener): void;
  removeEventListener(type: "open" | "close" | "error" | "message", listener: EventListener): void;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface OnlineMatchSession {
  readonly socket: WebSocket;
  readonly displayName: string;
  readonly reconnectToken?: ReconnectToken;
  readonly matchId: MatchId;
  readonly playerId: PlayerId;
  readonly opponentName: string;
  readonly playerArchetype: ArchetypeId;
  readonly opponentArchetype: ArchetypeId;
}

export interface OnlineLobbyOptions {
  readonly startMatch: (session: OnlineMatchSession) => void;
  readonly onReturnToTitle: () => void;
  readonly createSocket?: () => WebSocketLike;
  readonly storage?: StorageLike;
}

export interface OnlineLobbyController {
  dispose(): void;
}

/** Mounts the client-only online lobby. The match controller owns the socket after startMatch. */
export function mountOnlineLobby(
  root: HTMLElement,
  options: OnlineLobbyOptions,
): OnlineLobbyController {
  const storage = options.storage ?? window.localStorage;
  const createSocket = options.createSocket ?? defaultSocket;
  let displayName = storage.getItem(DISPLAY_NAME_KEY) ?? "";
  let reconnectToken = storage.getItem(RECONNECT_TOKEN_KEY) ?? undefined;
  let matches: readonly LobbyMatch[] = [];
  let view: LobbyView = displayName ? "lobby" : "identity";
  let selectedArchetype: ArchetypeId | null = null;
  let selectedMatch: LobbyMatch | null = null;
  let matchName = "";
  let notice = "";
  let socket: WebSocketLike | null = null;
  let socketListeners: {
    readonly connection: WebSocketLike;
    readonly onOpen: EventListener;
    readonly onMessage: EventListener;
    readonly onFailure: EventListener;
  } | null = null;
  let disposed = false;
  let handedOff = false;

  const onClick = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-lobby-action]");
    if (!button) return;

    switch (button.dataset.lobbyAction) {
      case "save-name":
        saveName();
        return;
      case "edit-name":
        disconnect();
        view = "identity";
        notice = "";
        render();
        return;
      case "create":
        view = "create";
        selectedArchetype = null;
        notice = "";
        render();
        return;
      case "join": {
        const match = matches.find((candidate) => candidate.id === button.dataset.matchId);
        if (!match) return;
        selectedMatch = match;
        selectedArchetype = null;
        view = "join";
        notice = "";
        render();
        return;
      }
      case "pick-archetype": {
        const archetype = button.dataset.archetype;
        if (isArchetypeId(archetype)) {
          captureMatchName();
          selectedArchetype = archetype;
          render();
        }
        return;
      }
      case "submit-create":
        submitCreate();
        return;
      case "submit-join":
        submitJoin();
        return;
      case "back-lobby":
        view = "lobby";
        selectedArchetype = null;
        selectedMatch = null;
        notice = "";
        render();
        return;
      case "retry":
        reconnect();
        return;
      case "back-title":
        disconnect(true);
        options.onReturnToTitle();
    }
  };

  function render(): void {
    if (disposed) return;
    root.innerHTML = lobbyMarkup(view, {
      displayName,
      matches,
      selectedArchetype,
      selectedMatch,
      matchName,
      notice,
    });
  }

  function saveName(): void {
    const input = root.querySelector<HTMLInputElement>("[data-display-name]");
    const name = cleanName(input?.value ?? "");
    if (!name) {
      notice = "Choose a display name between 1 and 24 characters.";
      render();
      return;
    }
    displayName = name;
    storage.setItem(DISPLAY_NAME_KEY, name);
    notice = "";
    view = "lobby";
    reconnect();
  }

  function submitCreate(): void {
    const input = root.querySelector<HTMLInputElement>("[data-match-name]");
    const name = cleanMatchName(input?.value ?? "");
    matchName = input?.value ?? matchName;
    if (!name) {
      notice = "Name your match with 1 to 48 characters.";
      render();
      return;
    }
    if (!selectedArchetype) {
      notice = "Pick an archetype before creating the match.";
      render();
      return;
    }
    send({ type: "lobby.create", name, archetype: selectedArchetype });
  }

  function submitJoin(): void {
    if (!selectedMatch || !selectedArchetype) {
      notice = "Pick an archetype before joining.";
      render();
      return;
    }
    send({ type: "lobby.join", matchId: selectedMatch.id, archetype: selectedArchetype });
  }

  function reconnect(): void {
    disconnect();
    view = "lobby";
    notice = "Connecting to the arena...";
    render();

    try {
      const connection = createSocket();
      socket = connection;
      const onOpen: EventListener = () => {
        if (disposed || socket !== connection) return;
        send({
          type: "hello",
          version: PROTOCOL_VERSION,
          displayName,
          reconnectToken,
        });
      };
      const onMessage: EventListener = (event) => {
        if (disposed || socket !== connection) return;
        const messageEvent = event as MessageEvent<string>;
        receive(parseServerMessage(messageEvent.data));
      };
      const onFailure: EventListener = () => {
        if (disposed || handedOff || socket !== connection) return;
        detachSocketListeners();
        socket = null;
        view = "failed";
        notice = "Could not reach online play. Check your connection and try again.";
        render();
      };
      connection.addEventListener("open", onOpen);
      connection.addEventListener("message", onMessage);
      connection.addEventListener("error", onFailure);
      connection.addEventListener("close", onFailure);
      socketListeners = { connection, onOpen, onMessage, onFailure };
    } catch {
      socket = null;
      view = "failed";
      notice = "Could not open an online connection. Try again.";
      render();
    }
  }

  function receive(message: ServerMessage | null): void {
    if (!message) return;
    switch (message.type) {
      case "welcome":
        reconnectToken = message.reconnectToken;
        displayName = message.displayName;
        storage.setItem(RECONNECT_TOKEN_KEY, message.reconnectToken);
        storage.setItem(DISPLAY_NAME_KEY, message.displayName);
        notice = "";
        render();
        return;
      case "lobby.snapshot":
        matches = message.matches;
        if (view === "lobby") render();
        return;
      case "match.waiting":
        selectedMatch = message.match;
        view = "waiting";
        notice = "";
        render();
        return;
      case "match.started":
        if (!socket) return;
        handedOff = true;
        options.startMatch({
          socket: socket as WebSocket,
          displayName,
          reconnectToken,
          matchId: message.matchId,
          playerId: message.playerId,
          opponentName: message.opponentName,
          playerArchetype: message.playerArchetype,
          opponentArchetype: message.opponentArchetype,
        });
        dispose(false);
        return;
      case "error":
        notice = message.message;
        if (message.code === "match_unavailable") {
          selectedMatch = null;
          selectedArchetype = null;
          view = "lobby";
          send({ type: "lobby.list" });
        }
        render();
        return;
      default:
        return;
    }
  }

  function send(message: ClientMessage): void {
    if (!socket || socket.readyState !== 1) {
      view = "failed";
      notice = "The online connection closed. Try again.";
      render();
      return;
    }
    socket.send(JSON.stringify(message));
  }

  function disconnect(leaveMatch = false): void {
    const connection = socket;
    socket = null;
    detachSocketListeners();
    if (!connection) return;
    if (leaveMatch && connection.readyState === 1) {
      connection.send(JSON.stringify({ type: "match.leave" } satisfies ClientMessage));
    }
    connection.close();
  }

  function dispose(closeSocket = true): void {
    if (disposed) return;
    disposed = true;
    root.removeEventListener("click", onClick);
    if (closeSocket) {
      disconnect();
    } else {
      detachSocketListeners();
    }
  }

  function detachSocketListeners(): void {
    if (!socketListeners) return;
    const { connection, onOpen, onMessage, onFailure } = socketListeners;
    connection.removeEventListener("open", onOpen);
    connection.removeEventListener("message", onMessage);
    connection.removeEventListener("error", onFailure);
    connection.removeEventListener("close", onFailure);
    socketListeners = null;
  }

  function captureMatchName(): void {
    matchName = root.querySelector<HTMLInputElement>("[data-match-name]")?.value ?? matchName;
  }

  root.addEventListener("click", onClick);
  render();
  if (displayName) reconnect();

  return { dispose };
}

function lobbyMarkup(view: LobbyView, state: {
  readonly displayName: string;
  readonly matches: readonly LobbyMatch[];
  readonly selectedArchetype: ArchetypeId | null;
  readonly selectedMatch: LobbyMatch | null;
  readonly matchName: string;
  readonly notice: string;
}): string {
  switch (view) {
    case "identity":
      return `
        <main class="flow-screen online-screen identity-screen" data-testid="online-name-screen">
          ${screenHeading("ENTER ONLINE PLAY", "Choose the name other battlers will see.")}
          <section class="online-panel">
            <label class="online-label" for="display-name">DISPLAY NAME</label>
            <input id="display-name" class="online-input" data-display-name maxlength="24" value="${escapeAttribute(state.displayName)}" autocomplete="nickname" autofocus>
            ${noticeMarkup(state.notice)}
            <button class="flow-primary" data-lobby-action="save-name">ENTER LOBBY</button>
          </section>
          <button class="flow-back" data-lobby-action="back-title">BACK</button>
        </main>
      `;
    case "create":
      return roomSetupMarkup("CREATE MATCH", "Name your room, then lock in an archetype.", state, "submit-create");
    case "join":
      return roomSetupMarkup(
        "JOIN MATCH",
        state.selectedMatch ? `Facing ${escapeHtml(state.selectedMatch.creatorName)} in ${escapeHtml(state.selectedMatch.name)}.` : "Choose your archetype.",
        state,
        "submit-join",
      );
    case "waiting":
      return `
        <main class="flow-screen online-screen waiting-screen" data-testid="online-waiting-screen">
          <section class="online-panel waiting-panel">
            <span class="waiting-signal" aria-hidden="true">◌</span>
            <span class="screen-kicker">MATCH CREATED</span>
            <h1>WAITING FOR OPPONENT...</h1>
            <p>${state.selectedMatch ? `${escapeHtml(state.selectedMatch.name)} is open in the lobby.` : "Your match is open in the lobby."}</p>
            <button class="flow-secondary" data-lobby-action="back-title">CANCEL MATCH</button>
          </section>
        </main>
      `;
    case "failed":
      return `
        <main class="flow-screen online-screen waiting-screen" data-testid="online-connection-error">
          <section class="online-panel waiting-panel">
            <span class="screen-kicker">CONNECTION LOST</span>
            <h1>ONLINE PLAY IS OFFLINE</h1>
            ${noticeMarkup(state.notice)}
            <div class="online-actions">
              <button class="flow-primary" data-lobby-action="retry">RETRY</button>
              <button class="flow-secondary" data-lobby-action="back-title">MAIN MENU</button>
            </div>
          </section>
        </main>
      `;
    case "lobby":
      return `
        <main class="flow-screen online-screen lobby-screen" data-testid="online-lobby-screen">
          ${screenHeading("ONLINE LOBBY", `Signed in as ${escapeHtml(state.displayName)}.`)}
          <section class="online-panel match-list-panel">
            <div class="lobby-toolbar">
              <div>
                <span class="online-label">OPEN MATCHES</span>
                <small>${state.notice ? escapeHtml(state.notice) : "Live updates are on."}</small>
              </div>
              <button class="flow-secondary compact-button" data-lobby-action="create">CREATE MATCH</button>
            </div>
            <div class="match-list">
              ${state.matches.length ? state.matches.map(matchRow).join("") : '<p class="empty-match-list">No open matches. Make one and bring the chaos.</p>'}
            </div>
          </section>
          <div class="online-actions">
            <button class="flow-back" data-lobby-action="edit-name">EDIT NAME</button>
            <button class="flow-back" data-lobby-action="back-title">BACK</button>
          </div>
        </main>
      `;
  }
}

function roomSetupMarkup(title: string, subtitle: string, state: {
  readonly selectedArchetype: ArchetypeId | null;
  readonly matchName: string;
  readonly notice: string;
}, submitAction: "submit-create" | "submit-join"): string {
  const isCreate = submitAction === "submit-create";
  return `
    <main class="flow-screen online-screen room-setup-screen" data-testid="online-room-setup-screen">
      ${screenHeading(title, subtitle)}
      <section class="online-panel room-setup-panel">
        ${isCreate ? `
          <label class="online-label" for="match-name">MATCH NAME</label>
          <input id="match-name" class="online-input" data-match-name maxlength="48" value="${escapeAttribute(state.matchName)}" placeholder="Friday night duel" autofocus>
        ` : ""}
        <span class="online-label">CHOOSE ARCHETYPE</span>
        <div class="lobby-archetype-grid">
          ${ARCHETYPES.map((archetype) => lobbyArchetypeCard(archetype, state.selectedArchetype === archetype.id)).join("")}
        </div>
        ${noticeMarkup(state.notice)}
        <div class="online-actions">
          <button class="flow-primary" data-lobby-action="${submitAction}">${isCreate ? "CREATE MATCH" : "JOIN MATCH"}</button>
          <button class="flow-secondary" data-lobby-action="back-lobby">BACK TO LOBBY</button>
        </div>
      </section>
    </main>
  `;
}

function matchRow(match: LobbyMatch): string {
  return `
    <article class="lobby-match-row">
      <div>
        <strong>${escapeHtml(match.name)}</strong>
        <small>Hosted by ${escapeHtml(match.creatorName)}</small>
      </div>
      <button class="flow-secondary compact-button" data-lobby-action="join" data-match-id="${escapeAttribute(match.id)}">JOIN</button>
    </article>
  `;
}

function lobbyArchetypeCard(archetype: (typeof ARCHETYPES)[number], selected: boolean): string {
  const [first, second] = archetype.elements;
  const fusionNames = deriveExtraDeck(archetype.id).map((card) => card.name.replace(" Beast", "")).join(" · ");
  return `
    <button class="lobby-archetype-card${selected ? " is-selected" : ""}" data-lobby-action="pick-archetype" data-archetype="${archetype.id}">
      <span class="element-pair"><i class="element-orb element-${first}"></i><i class="element-link"></i><i class="element-orb element-${second}"></i></span>
      <strong>${elementName(first)} + ${elementName(second)}</strong>
      <small>${fusionNames}</small>
    </button>
  `;
}

function screenHeading(title: string, subtitle: string): string {
  return `<header class="screen-heading"><span class="screen-kicker">BEAST BATTLER</span><h1>${title}</h1><p>${subtitle}</p></header>`;
}

function noticeMarkup(notice: string): string {
  return notice ? `<p class="online-notice" role="status">${escapeHtml(notice)}</p>` : "";
}

function defaultSocket(): WebSocketLike {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return new WebSocket(`${protocol}//${window.location.host}/ws`);
}

function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const message: unknown = JSON.parse(raw);
    return message && typeof message === "object" && "type" in message
      ? message as ServerMessage
      : null;
  } catch {
    return null;
  }
}

function cleanName(value: string): string | null {
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned && cleaned.length <= 24 ? cleaned : null;
}

function cleanMatchName(value: string): string | null {
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned.length >= 1 && cleaned.length <= 48 ? cleaned : null;
}

function isArchetypeId(value: string | undefined): value is ArchetypeId {
  return ARCHETYPES.some((archetype) => archetype.id === value);
}

function elementName(element: string): string {
  return `${element.charAt(0).toUpperCase()}${element.slice(1)}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
