import type { PendingStackItem } from "../rules/core";

export interface StackResolution {
  readonly resolved: readonly PendingStackItem[];
  readonly countered: readonly PendingStackItem[];
}

export function resolveStackEvents(
  stack: readonly PendingStackItem[],
): StackResolution {
  const counteredIds = new Set<string>();
  const resolved: PendingStackItem[] = [];
  const countered: PendingStackItem[] = [];

  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const item = stack[index];
    if (counteredIds.has(item.stackId)) {
      countered.push(item);
      continue;
    }

    resolved.push(item);
    if (
      item.kind === "spell" &&
      item.card.id === "counterspell" &&
      item.targetStackId
    ) {
      counteredIds.add(item.targetStackId);
    }
  }

  return { resolved, countered };
}
