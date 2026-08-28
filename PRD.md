# Beast Battler — Product Requirements Document

Working title: **Beast Battler**
Version: 1.0 (V1 spec)
Status: Approved spec lock (design grilling complete)

## 1. Vision

A simplified collectible card battler in the browser — Magic: The Gathering's resource system stripped to its bones, Yu-Gi-Oh's hologram-summon spectacle. Two players summon elemental beasts onto a 3D duel arena; beasts appear as glowing holograms. Any two beasts can fuse into a more powerful fusion beast with a full-screen setpiece animation.

**Design pillars:**

1. **Spectacle** — summoning and fusing must feel like the Yu-Gi-Oh anime: holograms materializing, light, particles.
2. **Simplicity** — card interactions are deliberately capped. No face-downs, no gang-blocking, no stack wars, no deckbuilding in V1. Interaction creep is the enemy.
3. **Fusion is the star** — the fusion system is the core identity and the main tempo play.

## 2. Platform & Technical Stack

- Browser single-page app. No backend in V1.
- **TypeScript + Vite + Three.js.**
- All card/monster visuals are **procedural** (code-generated low-poly models + shaders). No external art assets, no rigged/skeletal animation.
- Game rules core should be a pure, UI-independent TypeScript module (testable without the renderer).

## 3. Modes

- **V1:** Single-player vs AI, and local hotseat PvP (pass-the-device).
- **V1.1 (roadmap, not V1):** online PvP — matchmaking lobby where one player creates a match and another joins from the web page. Full spec: §14.

## 4. Core Rules

### 4.1 Numbers

- Each player starts at **10 LP**.
- Decks are **20 cards** (see §7 for formula assembly).
- Starting hand: **4 cards**. Each player gets **one free mulligan** per match (shuffle hand back, draw 4, no penalty).
- Draw 1 card per turn automatically at the start of the turn. **The first player skips their first-turn draw.**
- Max hand size **7** — discard down at end of turn.
- If you must draw from an empty deck, **you lose**.

### 4.2 Turn structure

Three playable phases, in order. The rules core resolves the mandatory draw
before main phase, so players never advance a draw phase themselves:

1. **Main** — play a land, summon monsters, cast spells, perform fusion actions
2. **Combat** — declare attackers, defender assigns blockers, resolve damage
3. **End** — clear all damage from monsters, discard down to 7

There is no second main phase.

### 4.3 Resources (lands)

- Lands are cards in the deck, element-typed (Fire, Water, Earth, Air, Lightning).
- **One land play per turn**, during your main phase.
- Lands produce 1 mana of their element per turn; mana does not carry over between turns.
- All base monsters cost **1 mana of their element**. Spells cost 1 mana of either of the deck's two elements.
- A player may summon **multiple monsters per turn** if they have the mana and cards (e.g. turn 2 with 2 lands: summon two 1-cost monsters and immediately fuse).

### 4.4 Monsters

- Monsters have **ATK** and **HP**. Base (unfused) monsters are level 1; fusions are level 2; upgraded fusions are level 3 (★3).
- **Summoning sickness:** a base monster cannot attack the turn it is summoned. It **can** block.
- **Damage does not persist:** all damage on monsters clears at end of turn (MTG-style).
- Board limit: **3 monster slots per player**. Lands live in a separate zone.
- Dead monsters (and any cards they absorbed) go to the discard pile permanently.

### 4.5 Combat

- Attacker declares which of their monsters attack (any number, none sick).
- Defender assigns blockers: **one blocker per attacker** (no gang-blocking). Summoning-sick monsters may block.
- Damage resolution:
  - A blocked attacker deals its ATK to its blocker. **Universal trample:** any ATK in excess of the blocker's HP is dealt to the defending player. (E.g. 3 ATK blocked by 1 HP → 1 to blocker, 2 to player.)
  - The blocker deals its ATK back to the attacker.
  - An unblocked attacker deals its ATK to the defending player.
- Monsters with damage ≥ HP die simultaneously.

### 4.6 Fusion

- Fusion is **optional** and performed as a **main-phase board action**. When a valid pair exists on your field, the UI prompts "Fuse?" — it never happens automatically.
- Fusing costs no mana — the cost is the two monsters already summoned (two 1-cost summons = 2 mana invested).
- The fusion result is determined by the **element pair** of the parents, not the specific monsters. Any Fire + any Water = Steam Beast.
- Both parents are consumed; the fusion monster takes **one** board slot. Parents do not return when the fusion dies.
- **Fusion grants haste:** a freshly fused monster may attack the turn it is created (unless it has Slow).
- Fusion monsters are never in the deck or hand — they live in the **extra deck** (§7.2) and enter play only via fusion.

#### 4.6.1 Level 3 (★3) upgrade

- As a main-phase action, a level-2 fusion may **absorb a base monster** on your field that shares one of the fusion's two elements (e.g. Steam Beast can absorb a Fire or Water base monster).
- The base monster is consumed; the fusion keeps its identity and gains a star pip and **+1/+1**.
- Cap: ★3. No fusion of two fusions. No further levels.

#### 4.6.2 Keywords

- **Burst** — "When this monster is created by fusion or upgraded to ★3, deal 1 damage to the opponent." Appears on: Inferno Beast, Plasma Beast.
- **Slow** — "This monster cannot attack the turn it enters play, even if created by fusion." Appears on: Tsunami Beast, Golem Beast.

### 4.7 Spells and the mini-stack

- Spells cost 1 mana (of either deck element) and are **sorceries** — playable only in your own main phase — except Counterspell.
- **Counterspell** is the **only instant**. It may be played in response to an opponent's monster summon or spell cast, and counters it (summoned monster never enters play; the card and mana are spent; spell has no effect). Counterspell costs 1, so threatening it requires leaving a land unused.
- **Stack rule:** at most **2** spells/effects may be pending at once. Exception: a Counterspell that targets another Counterspell may be the **3rd** (counter-the-counter). Nothing else may exceed 2.
- When a response window opens, the opponent is prompted to respond (in hotseat: hidden pass-the-device curtain, §9).

The four V1 spells:

| Spell | Type | Effect |
|---|---|---|
| Bolt | Sorcery | Deal 2 damage to any target (monster or player) |
| Destroy | Sorcery | Destroy target monster |
| Draw | Sorcery | Draw 2 cards |
| Counterspell | Instant | Counter target monster summon or spell |

## 5. Card List (29 cards)

29 named chart cards (10 base + 15 fusion + 4 spells). Elemental **lands are not
chart cards** — the deck assembler generates land instances (§7.1): 5 element
types, each just `{ element, name: "<Element> Land" }`, no ATK/HP/cost.

Numbers are ATK/HP. All base monsters cost 1 of their element.

### 5.1 Base monsters (10)

| Element | Aggressive body | Defensive body |
|---|---|---|
| Fire | Ember Imp 2/1 | Cinder Wall 1/2 |
| Water | Tide Serpent 1/2 | Reef Guardian 1/3 |
| Earth | Stone Bull 2/2 | Moss Tortoise 1/3 |
| Air | Gale Hawk 2/1 | Cloud Sprite 1/2 |
| Lightning | Spark Lynx 2/1 | Volt Bat 1/2 |

### 5.2 Fusion monsters (15)

| Pair | Name | Stats | Keyword |
|---|---|---|---|
| Fire + Fire | Inferno Beast | 4/2 | Burst |
| Fire + Water | Steam Beast | 3/3 | — |
| Fire + Earth | Magma Beast | 4/3 | — |
| Fire + Air | Wildfire Beast | 4/2 | — |
| Fire + Lightning | Plasma Beast | 4/2 | Burst |
| Water + Water | Tsunami Beast | 2/5 | Slow |
| Water + Earth | Swamp Beast | 2/4 | — |
| Water + Air | Ice Beast | 3/4 | — |
| Water + Lightning | Storm Beast | 3/4 | — |
| Earth + Earth | Golem Beast | 3/5 | Slow |
| Earth + Air | Sandstorm Beast | 3/4 | — |
| Earth + Lightning | Crystal Beast | 3/4 | — |
| Air + Air | Cyclone Beast | 4/3 | — |
| Air + Lightning | Thunderbird Beast | 4/3 | — |
| Lightning + Lightning | Thunder Beast | 4/3 | — |

### 5.3 Spells (4)

See §4.7 table.

## 6. Elements

Fire, Water, Earth, Air, Lightning. Element identity is expressed through stat spreads (Fire aggressive, Water/Earth defensive, Air/Lightning aggressive-leaning) and through the procedural model/shader art direction (§8).

## 7. Decks & Archetypes

### 7.1 Formula assembly (no deckbuilding in V1)

Each deck is built around a **2-element pair** (10 possible archetypes: Fire/Water, Fire/Earth, … Air/Lightning). Every deck is assembled by formula:

- **8 lands** — 4 of each element
- **8 monsters** — 2 copies of each of the 4 base monsters in those two elements
- **4 spells** — 1× Bolt, 1× Destroy, 1× Draw, 1× Counterspell

Both players pick an archetype at match start. Mirror matches are allowed.

### 7.2 Extra deck

Each archetype's extra deck contains exactly the **3 fusion monsters** matching its element pairs: A+A, A+B, B+B. (E.g. a Fire/Water deck: Inferno Beast, Steam Beast, Tsunami Beast.) Extra-deck contents are viewable in-match via a side panel.

## 8. Art Direction

- **Scene:** dark sci-fi duel arena (Yu-Gi-Oh hologram-field energy). Subtle floor grid, element-tinted accent lighting per player side, restrained camera (slight idle drift; punch-in on summon/fusion).
- **Monsters:** procedural low-poly models composed from primitives, built per element family (5 archetypes with palette/appendage variation across the 25 monsters).
- **Hologram shader:** additive glow, fresnel rim light, scanlines, slight flicker, element color palette. Monsters read as projections, not solid matter.
- **Card art:** in-engine render-to-portrait — each 3D monster posed against its element backdrop, rendered to an image used as its card art. No external art pipeline for cards.
- **Logo/title art:** generated externally with a text-to-image tool (owner-provided, 3–5 generations budgeted).

## 9. Animation Spec (all procedural — transforms, particles, shaders; no rigging)

- **Summon:** vertical beam; monster materializes bottom-up with particles.
- **Attack:** lunge toward target + impact flash + light screen shake.
- **Hit:** white flash + knockback wobble.
- **Death:** glitch dissolve upward.
- **Fusion (setpiece):** two holograms spiral together → flash → fusion monster materializes at larger scale. ★3 upgrade reuses a shorter version.
- **Spells:** one signature effect each — Bolt = projectile streak, Destroy = shatter, Draw = card flourish, Counterspell = blue negate ripple.
- **Burst:** small damage bolt to the opponent's LP counter.

## 10. AI Opponent

Scripted priority list (no search, no ML). Each AI turn:

1. Play a land if able.
2. Summon monsters while mana/hand allow, preferring the monster that completes a fusion pair on board.
3. Fuse whenever a valid pair exists (including ★3 absorbs).
4. Attack with every non-sick, non-Slow monster **if** the opponent has fewer potential blockers than the AI has attackers; otherwise hold back.
5. Bolt: target an enemy fusion monster; if none, go face only when lethal.
6. Destroy: the highest-ATK enemy monster.
7. Counterspell: only against fusion summons and Destroy, and only when it has 1 mana open.

Difficulty tuning is deferred to playtesting.

## 11. Screens & Match Flow

Boot → **Title** (generated logo) → **Mode select** (vs AI / Hotseat) → **Deck select** (each player picks an element-pair archetype; hotseat passes device between picks) → **Match** → **Win/lose screen** → Rematch or menu.

Match UI layout:

- Your monsters front row, lands back row, hand fanned at bottom; opponent mirrored.
- LP counters top corners.
- Extra-deck panel (view your 3 fusion targets).
- "Fuse?" prompt appears in main phase when a valid pair exists; with multiple valid pairs, the player picks which.

Hotseat specifics:

- Hands are hidden behind a **pass-the-device curtain** ("Player N — press when ready") at each turn change.
- Counterspell response windows also use the curtain: "Opponent may respond — pass the device." The counterspell stays secret until played.

## 12. Definition of Done (V1)

One complete playable match, end to end:

- All 29 cards implemented with the approved data.
- Full ruleset per §4, including trample, summoning sickness, mini-stack, deck-out, mulligan.
- Fusion + ★3 + Burst/Slow keywords working with the setpiece animation.
- AI opponent per §10.
- Hotseat PvP with curtains.
- Hologram monsters, summon/attack/hit/death/spell animations per §9.
- Card art from the in-engine render pipeline.
- Title/mode/deck-select/results screens.

**Explicitly out of scope for V1:** deckbuilding, online play (V1.1), settings menus, audio (or minimal placeholder), per-creature bespoke animation, mobile layout, Heal/Surge spells (cut), account/persistence systems.

## 13. Suggested Ticket Breakdown (for Orbit Track)

1. **Scaffold** — Vite + TS + Three.js app, boot to empty scene.
2. **Rules core** — pure TS game-state engine: turns, phases, mana, draw, LP, win/loss. (No rendering.)
3. **Card data module** — all 29 cards as typed data; deck formula assembler; extra-deck derivation.
4. **Combat resolver** — attackers/blockers, trample, sickness, damage cleanup, death.
5. **Fusion system** — pair detection, prompts, extra-deck summons, ★3 absorb, Burst/Slow.
6. **Spell system** — sorcery timing, Counterspell response windows, mini-stack (cap 2 + counter-of-counter).
7. **AI opponent** — priority-list per §10.
8. **3D board scene** — arena, zones, camera, lighting.
9. **Procedural monster models** — 5 element families → 25 variants.
10. **Hologram shader** — fresnel/scanline/flicker treatment.
11. **Animation system** — summon/attack/hit/death/spell/fusion setpiece per §9.
12. **Card art pipeline** — render-to-portrait for all monsters.
13. **Match UI** — hand, board, LP, prompts, extra-deck panel.
14. **Screen flow** — title, mode select, deck select, results, rematch.
15. **Hotseat mode** — turn-change + response curtains.
16. **Playtest & tuning pass** — stall check, AI difficulty, numbers sanity.

Dependency note: 2 → 3 → 4/5/6 → 7 is the rules-critical path; 8 → 9 → 10 → 11 → 12 is the visual path; 13/14/15 glue them; 16 last.

## 14. v1.1 — Online Lobby Play

Online PvP between two browsers on the public site. Everything in §1–§12
(rules, cards, art, animation) is unchanged; this section only adds how two
players find each other and how the wire works.

### 14.1 Scope & non-goals

- **In:** display-name identity, lobby with live match list, create/join a
  match, server-authoritative online matches, disconnect grace with
  reconnection, decision timers, rematch button.
- **Out:** accounts/passwords, match history, replays, spectating, chat,
  ranking/ELO, quick-match auto-pairing, >2 players per match.

### 14.2 Architecture

- **One service.** The WebSocket endpoint attaches to the existing HTTP
  server (`server.mjs`) on the same port — no new infra, same Railway deploy.
- **`ws` is the one new dependency.** Native WebSocket performance; the rest
  of the server stays zero-dependency.
- **Server-authoritative.** The server imports the *same* `src/rules` engine
  the browser uses (compiled to plain JS by a `tsc` emit step added to the
  build) and owns the real `MatchState` for every online match. Clients send
  intents ("declare these attackers", "cast Bolt on X"); the server validates
  against the engine and broadcasts results. No rules logic is re-implemented
  anywhere.
- **In-memory rooms.** Matches and the lobby live in server memory. A deploy
  or restart drops active games — accepted at this scale. Single instance
  only (no horizontal replicas).
- **AI and hotseat modes are untouched** — they never talk to the server.

### 14.3 Identity

- Display name only, typed once, stored in `localStorage`. No password, no
  persistence server-side. Names are shown in the lobby and in-match.
- A reconnect token (random, `localStorage`) identifies a player's seat.

### 14.4 Lobby

- Third mode on the title screen: **Online**. Leads to: name entry (first
  visit only) → lobby screen.
- Lobby shows the list of **open matches** (creator name + match name).
  Create a match: name it, pick your archetype → you wait in the match room.
  Join: pick your archetype → the match starts immediately. Mirrors allowed.
- **Live updates, no polling.** The server pushes lobby changes
  (created/joined/closed) to every connected lobby client over the WebSocket
  the moment they happen. Matches leave the list when joined or abandoned.

### 14.5 Wire protocol & hidden information

- JSON messages over one WebSocket per client. Intents upstream; state
  downstream. (Exact message shapes are an implementation detail, versioned
  with a `type` field per message.)
- **Per-player filtered views.** The server sends each client only what that
  player may see: own hand in full, opponent's hand as a count, both boards,
  both extra decks, stack, log. The counterspell bluff (§4.7) must survive
  online play — no full-state leaks to either browser.
- The server is the only writer of game state; a client that sends an illegal
  intent gets an error notice, never a state change.

### 14.6 Disconnects & reconnection

- Losing the socket starts a **60-second grace window**
  (`RECONNECT_GRACE_MS = 60000`). The match pauses (timers freeze).
- Both sides see it: the connected player gets "Opponent disconnected —
  waiting Ns" with a live countdown; the disconnected player, on reopening
  the page, gets "Disconnected — rejoining in Ns" and is dropped straight
  back into the match via the reconnect token.
- Grace expiry = **forfeit**; the connected player is told they won and
  returned to the lobby.

### 14.7 Decision timers

Every decision point is timed to keep matches moving. Constants (one-line
tuning, names required in code):

- `TIMER_QUIET_MS = 5000` — after 5s of inactivity at your decision point…
- `TIMER_COUNTDOWN_MS = 5000` — …a visible 5s countdown appears.
- On expiry the server acts for you: main phase → end phase; combat → hold;
  blockers → no blocks; counterspell window → pass; mulligan → keep;
  fusion prompt → decline.
- The clock **resets on every action you take**, so multi-action main phases
  are never starved — only true inactivity triggers the countdown.
- Timers are server-enforced; the client only renders them.

### 14.8 Rematch

- On the results screen, if both players are still connected, each gets a
  **Rematch** button. Both accepting starts a fresh match with the same
  archetypes (new shuffle, new mulligan). If either leaves, the other
  returns to the lobby.

### 14.9 Ticket breakdown (v1.1)

1. **WS server + room manager** — `ws` attached to `server.mjs`, rules-engine
   server build step, rooms, lobby protocol (push updates), reconnect tokens
   + 60s grace.
2. **Lobby UI** — Online entry point, name entry, live match list,
   create/join flow.
3. **Online match controller** — intent/state netcode, per-player filtered
   rendering, disconnect countdown overlays, rematch flow.
4. **Decision timers** — server enforcement per §14.7 + countdown UI.
5. **Live verification** — two-browser match on production end to end.

Dependency chain: 1 → 2 → 3 → 4 → 5 (1 also directly blocks 3).
