// Die geladene Bibliothek, geteilt zwischen Raster, Filmstreifen und Entwickeln.

import { create } from "zustand";
import { api, type Bild, type Filter } from "../api";
import { melde } from "../ui";

const FILTER_SCHLUESSEL = "captr-filter";
const SAMMLUNG_SCHLUESSEL = "captr-sammlung";

// Sammlungen wie im Katalog einer Fotoverwaltung. Sie wirken zusaetzlich zum
// Filter und nur im Browser: "alle", "zuletzt", "bearbeitet", "unbearbeitet",
// "jahr:2026", "monat:2026-10", "kamera:<Name>".
export function inSammlung(b: Bild, s: string, zuletzt: string): boolean {
  if (!s || s === "alle") return true;
  if (s === "bearbeitet") return b.bearbeitet;
  if (s === "unbearbeitet") return !b.bearbeitet;
  if (s === "zuletzt") return tag(b.angelegt) === zuletzt;
  const [art, wert] = [s.slice(0, s.indexOf(":")), s.slice(s.indexOf(":") + 1)];
  if (art === "jahr") return datumVon(b).startsWith(wert);
  if (art === "monat") return datumVon(b).startsWith(wert);
  if (art === "kamera") return (b.kamera || "Unbekannte Kamera") === wert;
  return true;
}

export const tag = (iso: string) => (iso || "").slice(0, 10);
// Aufnahmedatum, sonst Importdatum
export const datumVon = (b: Bild) => tag(b.aufgenommen) || tag(b.angelegt);
// Tag des juengsten Imports
export const letzterImport = (bilder: Bild[]) => bilder.reduce((m, b) => (tag(b.angelegt) > m ? tag(b.angelegt) : m), "");

export function sichtbar(bilder: Bild[], sammlung: string): Bild[] {
  if (!sammlung || sammlung === "alle") return bilder;
  const z = letzterImport(bilder);
  return bilder.filter((b) => inSammlung(b, sammlung, z));
}

function gespeicherterFilter(): Filter {
  try {
    return JSON.parse(localStorage.getItem(FILTER_SCHLUESSEL) ?? "{}");
  } catch {
    return {};
  }
}

interface Bibliothek {
  bilder: Bild[]; // nach Filter
  alle: Bild[]; // ohne Filter und Sammlung, fuer den Filmstreifen
  geladen: boolean;
  filter: Filter;
  auswahl: string[]; // markierte Kennungen, die erste ist die aktive
  sammlung: string;
  setzeSammlung: (s: string) => void;
  setzeFilter: (f: Partial<Filter>) => void;
  laden: () => Promise<void>;
  ersetze: (b: Bild) => void;
  fuegeHinzu: (b: Bild[]) => void;
  entferne: (id: string) => void;
  waehle: (id: string, art?: "einzeln" | "dazu" | "bereich", liste?: Bild[]) => void;
  aendere: (ids: string[], ae: Parameters<typeof api.aendern>[1]) => Promise<void>;
}

export const useBibliothek = create<Bibliothek>((set, get) => ({
  bilder: [],
  alle: [],
  geladen: false,
  filter: gespeicherterFilter(),
  auswahl: [],
  sammlung: (() => {
    try {
      return localStorage.getItem(SAMMLUNG_SCHLUESSEL) ?? "alle";
    } catch {
      return "alle";
    }
  })(),
  setzeSammlung: (sammlung) => {
    try {
      localStorage.setItem(SAMMLUNG_SCHLUESSEL, sammlung);
    } catch {
      /* egal */
    }
    set({ sammlung });
  },
  setzeFilter: (f) => {
    const filter = { ...get().filter, ...f };
    try {
      localStorage.setItem(FILTER_SCHLUESSEL, JSON.stringify(filter));
    } catch {
      /* egal */
    }
    set({ filter });
    void get().laden();
  },
  laden: async () => {
    try {
      const f = get().filter;
      const ohneFilter = !f.bewertung && !f.markierung && !f.art && !f.farbe && !f.suche;
      const [bilder, alle] = await Promise.all([api.bilder(f), ohneFilter ? null : api.bilder({ ordnung: f.ordnung })]);
      const da = new Set((alle ?? bilder).map((b) => b.id));
      set({ bilder, alle: alle ?? bilder, geladen: true, auswahl: get().auswahl.filter((id) => da.has(id)) });
    } catch (e) {
      set({ geladen: true });
      melde("Bibliothek nicht geladen: " + (e as Error).message, "fehler");
    }
  },
  ersetze: (b) => set({ bilder: get().bilder.map((x) => (x.id === b.id ? b : x)), alle: get().alle.map((x) => (x.id === b.id ? b : x)) }),
  fuegeHinzu: (neu) =>
    set({
      bilder: [...neu, ...get().bilder.filter((b) => !neu.some((n) => n.id === b.id))],
      alle: [...neu, ...get().alle.filter((b) => !neu.some((n) => n.id === b.id))],
    }),
  entferne: (id) =>
    set({ bilder: get().bilder.filter((b) => b.id !== id), alle: get().alle.filter((b) => b.id !== id), auswahl: get().auswahl.filter((x) => x !== id) }),
  waehle: (id, art = "einzeln", liste) => {
    const { auswahl } = get();
    const bilder = liste ?? sichtbar(get().bilder, get().sammlung);
    if (art === "dazu") {
      set({ auswahl: auswahl.includes(id) ? auswahl.filter((x) => x !== id) : [id, ...auswahl] });
    } else if (art === "bereich" && auswahl.length) {
      const a = bilder.findIndex((b) => b.id === auswahl[0]);
      const z = bilder.findIndex((b) => b.id === id);
      const [von, bis] = a < z ? [a, z] : [z, a];
      const bereich = bilder.slice(von, bis + 1).map((b) => b.id);
      set({ auswahl: [auswahl[0], ...bereich.filter((x) => x !== auswahl[0])] });
    } else {
      set({ auswahl: [id] });
    }
  },
  aendere: async (ids, ae) => {
    try {
      const neu = await Promise.all(ids.map((id) => api.aendern(id, ae)));
      const karte = new Map(neu.map((b) => [b.id, b]));
      set({ bilder: get().bilder.map((b) => karte.get(b.id) ?? b), alle: get().alle.map((b) => karte.get(b.id) ?? b) });
    } catch (e) {
      melde((e as Error).message, "fehler");
    }
  },
}));
