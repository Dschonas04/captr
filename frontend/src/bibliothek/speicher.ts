// Die geladene Bibliothek, geteilt zwischen Raster, Filmstreifen und Entwickeln.

import { create } from "zustand";
import { api, type Bild, type Filter } from "../api";
import { melde } from "../ui";

const FILTER_SCHLUESSEL = "captr-filter";

function gespeicherterFilter(): Filter {
  try {
    return JSON.parse(localStorage.getItem(FILTER_SCHLUESSEL) ?? "{}");
  } catch {
    return {};
  }
}

interface Bibliothek {
  bilder: Bild[];
  geladen: boolean;
  filter: Filter;
  auswahl: string[]; // markierte Kennungen, die erste ist die aktive
  setzeFilter: (f: Partial<Filter>) => void;
  laden: () => Promise<void>;
  ersetze: (b: Bild) => void;
  fuegeHinzu: (b: Bild[]) => void;
  entferne: (id: string) => void;
  waehle: (id: string, art?: "einzeln" | "dazu" | "bereich") => void;
  aendere: (ids: string[], ae: Parameters<typeof api.aendern>[1]) => Promise<void>;
}

export const useBibliothek = create<Bibliothek>((set, get) => ({
  bilder: [],
  geladen: false,
  filter: gespeicherterFilter(),
  auswahl: [],
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
      const bilder = await api.bilder(get().filter);
      const da = new Set(bilder.map((b) => b.id));
      set({ bilder, geladen: true, auswahl: get().auswahl.filter((id) => da.has(id)) });
    } catch (e) {
      set({ geladen: true });
      melde("Bibliothek nicht geladen: " + (e as Error).message, "fehler");
    }
  },
  ersetze: (b) => set({ bilder: get().bilder.map((x) => (x.id === b.id ? b : x)) }),
  fuegeHinzu: (neu) => set({ bilder: [...neu, ...get().bilder.filter((b) => !neu.some((n) => n.id === b.id))] }),
  entferne: (id) => set({ bilder: get().bilder.filter((b) => b.id !== id), auswahl: get().auswahl.filter((x) => x !== id) }),
  waehle: (id, art = "einzeln") => {
    const { auswahl, bilder } = get();
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
      set({ bilder: get().bilder.map((b) => karte.get(b.id) ?? b) });
    } catch (e) {
      melde((e as Error).message, "fehler");
    }
  },
}));
