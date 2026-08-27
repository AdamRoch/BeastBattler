import {
  CARD_ART_IDS,
  createCardArtRenderer,
  SPELL_CARD_IDS,
  type SpellCardId,
} from "./index";

const root = document.querySelector<HTMLDivElement>("#card-art-grid");
const status = document.querySelector<HTMLParagraphElement>("#render-status");

if (!root || !status) {
  throw new Error("Missing card-art preview roots");
}

const grid = root;
const renderStatus = status;
const renderer = createCardArtRenderer();

function addPortrait(cardId: (typeof CARD_ART_IDS)[number], source: string): void {
  const card = document.createElement("article");
  card.className = "art-card";
  card.dataset.cardId = cardId;
  card.dataset.kind = SPELL_CARD_IDS.includes(cardId as SpellCardId)
    ? "spell"
    : "monster";

  const image = document.createElement("img");
  image.src = source;
  image.alt = `${cardId} card art`;
  image.width = 384;
  image.height = 536;
  card.append(image);

  const title = document.createElement("h2");
  title.textContent = cardId;
  card.append(title);
  grid.append(card);
}

for (const [index, cardId] of CARD_ART_IDS.entries()) {
  renderStatus.textContent = `Rendering ${index + 1} of ${CARD_ART_IDS.length}: ${cardId}`;
  addPortrait(cardId, renderer.render(cardId));
}

renderStatus.textContent = `${CARD_ART_IDS.length} card-art images rendered`;
document.body.dataset.renderComplete = "true";
