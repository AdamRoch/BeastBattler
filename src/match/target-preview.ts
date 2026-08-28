export interface TargetPreview {
  show(source: Element, target: Element): void;
  hide(): void;
  dispose(): void;
}

export function createTargetPreview(root: HTMLElement): TargetPreview {
  const layer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  layer.classList.add("target-preview-layer");
  layer.setAttribute("hidden", "");
  layer.setAttribute("aria-hidden", "true");
  layer.setAttribute("preserveAspectRatio", "none");

  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
  marker.id = "target-preview-arrowhead";
  marker.setAttribute("viewBox", "0 0 10 10");
  marker.setAttribute("refX", "8");
  marker.setAttribute("refY", "5");
  marker.setAttribute("markerWidth", "8");
  marker.setAttribute("markerHeight", "8");
  marker.setAttribute("orient", "auto");
  const arrowhead = document.createElementNS("http://www.w3.org/2000/svg", "path");
  arrowhead.classList.add("target-preview-arrowhead");
  arrowhead.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
  marker.append(arrowhead);
  defs.append(marker);

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.classList.add("target-preview-path");
  path.setAttribute("marker-end", "url(#target-preview-arrowhead)");
  layer.append(defs, path);
  root.append(layer);

  return {
    show(source, target) {
      const sourceBounds = source.getBoundingClientRect();
      const targetBounds = target.getBoundingClientRect();
      const startX = sourceBounds.left + sourceBounds.width / 2;
      const startY = sourceBounds.top + sourceBounds.height / 2;
      const endX = targetBounds.left + targetBounds.width / 2;
      const endY = targetBounds.top + targetBounds.height / 2;
      const bend = Math.max(42, Math.abs(endY - startY) * 0.22);
      const direction = endY < startY ? -1 : 1;

      layer.setAttribute("viewBox", `0 0 ${window.innerWidth} ${window.innerHeight}`);
      path.setAttribute(
        "d",
        `M ${startX} ${startY} C ${startX} ${startY + direction * bend}, ${endX} ${endY - direction * bend}, ${endX} ${endY}`,
      );
      layer.removeAttribute("hidden");
    },
    hide() {
      layer.setAttribute("hidden", "");
      path.removeAttribute("d");
    },
    dispose() {
      layer.remove();
    },
  };
}
