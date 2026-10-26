// Ersatz fuer @storyteller/keybinds: feste Tastenbelegung statt der in
// ArtCraft einstellbaren. Gleiche Schnittstelle, damit SideToolbar und
// usePagedrawKeybinds unveraendert bleiben koennen.
export type ActionId =
  | "pagedraw.tools.select"
  | "pagedraw.tools.shape"
  | "pagedraw.tools.brush"
  | "pagedraw.tools.mask"
  | "pagedraw.tools.eraser"
  | "pagedraw.tools.brushSizeUp"
  | "pagedraw.tools.brushSizeDown"
  | "pagedraw.history.undo"
  | "pagedraw.history.redo"
  | "pagedraw.edit.copy"
  | "pagedraw.edit.paste"
  | "pagedraw.edit.delete";

export interface Binding {
  key: string;
  mod?: boolean;
  shift?: boolean;
}

const belegung: Record<ActionId, Binding[]> = {
  "pagedraw.tools.select": [{ key: "v" }],
  "pagedraw.tools.shape": [{ key: "u" }],
  "pagedraw.tools.brush": [{ key: "b" }],
  "pagedraw.tools.mask": [],
  "pagedraw.tools.eraser": [{ key: "e" }],
  "pagedraw.tools.brushSizeUp": [{ key: "]" }],
  "pagedraw.tools.brushSizeDown": [{ key: "[" }],
  "pagedraw.history.undo": [{ key: "z", mod: true }],
  "pagedraw.history.redo": [{ key: "z", mod: true, shift: true }, { key: "y", mod: true }],
  "pagedraw.edit.copy": [{ key: "c", mod: true }],
  "pagedraw.edit.paste": [{ key: "v", mod: true }],
  "pagedraw.edit.delete": [{ key: "delete" }, { key: "backspace" }],
};

export function formatBinding(b?: Binding): string {
  if (!b) return "";
  const k = b.key.length === 1 ? b.key.toUpperCase() : b.key === "delete" ? "Entf" : b.key;
  return (b.mod ? "Strg+" : "") + (b.shift ? "⇧" : "") + k;
}

function passt(e: KeyboardEvent, b: Binding): boolean {
  return (
    e.key.toLowerCase() === b.key &&
    !!b.mod === (e.ctrlKey || e.metaKey) &&
    !!b.shift === e.shiftKey &&
    !e.altKey
  );
}

const resolved = {
  forAction: (id: ActionId) => belegung[id] ?? [],
  matchAction: (e: KeyboardEvent, _surface: string): ActionId | null => {
    for (const [id, liste] of Object.entries(belegung) as [ActionId, Binding[]][]) {
      if (liste.some((b) => passt(e, b))) return id;
    }
    return null;
  },
};

export function useResolvedKeybinds() {
  return resolved;
}

export function isEventFromEditableElement(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
}
