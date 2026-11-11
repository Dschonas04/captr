// Bausteine im Stil einer klassischen Fotoverwaltung: Seitenleisten mit
// Klapp-Panels, Navigator, Filmstreifen, Histogramm aus einem Vorschaubild.

import { useEffect, useState, type ReactNode } from "react";
import { create } from "zustand";
import { formatiereBelichtung, miniUrl, vorschauUrl, type Bild } from "./api";
import type { Histogramm } from "./entwickeln/gpu";
import { HistogrammAnzeige } from "./entwickeln/Kurve";
import { cx, farbeCss } from "./ui";

// ---------- Ein- und ausblendbare Leisten ----------

function gemerkt(k: string, standard: boolean) {
  try {
    const w = localStorage.getItem("captr-leiste-" + k);
    return w === null ? standard : w === "1";
  } catch {
    return standard;
  }
}

type Leiste = "links" | "rechts" | "film";

export const useLeisten = create<{ links: boolean; rechts: boolean; film: boolean; umschalten: (k: Leiste | "seiten") => void }>((set, get) => ({
  links: gemerkt("links", true),
  rechts: gemerkt("rechts", true),
  film: gemerkt("film", true),
  umschalten: (k) => {
    const s = get();
    const neu = k === "seiten" ? { links: !(s.links || s.rechts), rechts: !(s.links || s.rechts) } : { [k]: !s[k] };
    for (const [n, w] of Object.entries(neu)) {
      try {
        localStorage.setItem("captr-leiste-" + n, w ? "1" : "0");
      } catch {
        /* egal */
      }
    }
    set(neu);
  },
}));

// Tab blendet die Seitenleisten aus, F6 den Filmstreifen - wie gewohnt.
export function useLeistenTasten() {
  const umschalten = useLeisten((s) => s.umschalten);
  useEffect(() => {
    const taste = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || document.querySelector("[role=dialog]")) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Tab") {
        e.preventDefault();
        umschalten("seiten");
      } else if (e.key === "F6") {
        e.preventDefault();
        umschalten("film");
      }
    };
    window.addEventListener("keydown", taste);
    return () => window.removeEventListener("keydown", taste);
  }, [umschalten]);
}

// Schmaler Rand mit Dreieck, wenn die Leiste zu ist; sonst die Leiste selbst.
export function Seitenleiste({ seite, breite = 260, children, fuss }: { seite: "links" | "rechts"; breite?: number; children: ReactNode; fuss?: ReactNode }) {
  const offen = useLeisten((s) => s[seite]);
  const umschalten = useLeisten((s) => s.umschalten);
  const rand = seite === "links" ? "border-r" : "border-l";
  if (!offen)
    return (
      <button
        className={cx("group flex w-3 shrink-0 items-center justify-center bg-flaeche text-text-3 hover:bg-feld hover:text-text-2", rand, "border-linie")}
        onClick={() => umschalten(seite)}
        title="Leiste einblenden (Tab)"
        aria-label={seite === "links" ? "Linke Leiste einblenden" : "Rechte Leiste einblenden"}
      >
        <Dreieck richtung={seite === "links" ? "rechts" : "links"} />
      </button>
    );
  return (
    <aside className={cx("relative flex shrink-0 flex-col bg-flaeche", rand, "border-linie")} style={{ width: breite }}>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">{children}</div>
      {fuss && <div className="shrink-0 border-t border-linie p-2.5">{fuss}</div>}
      <button
        className={cx(
          "absolute top-1/2 z-10 flex h-10 w-2.5 -translate-y-1/2 items-center justify-center text-text-3 opacity-0 transition-opacity hover:text-text hover:opacity-100",
          seite === "links" ? "-right-[1px]" : "-left-[1px]",
        )}
        onClick={() => umschalten(seite)}
        title="Leiste ausblenden (Tab)"
        aria-label={seite === "links" ? "Linke Leiste ausblenden" : "Rechte Leiste ausblenden"}
      >
        <Dreieck richtung={seite === "links" ? "links" : "rechts"} />
      </button>
    </aside>
  );
}

export function Dreieck({ richtung, className }: { richtung: "links" | "rechts" | "unten"; className?: string }) {
  const d = { rechts: "M2 1 L8 5 L2 9 Z", links: "M8 1 L2 5 L8 9 Z", unten: "M1 2 L9 2 L5 8 Z" }[richtung];
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" className={cx("shrink-0 fill-current", className)} aria-hidden>
      <path d={d} />
    </svg>
  );
}

// ---------- Panel ----------

// Klappbares Panel. Links steht der Titel links, rechts rechtsbündig - so
// laufen die Köpfe zur Bildmitte hin, wie man es von Fotoprogrammen kennt.
export function Panel({
  titel,
  seite = "rechts",
  offen: anfangOffen = true,
  rechts,
  children,
  ohneRand,
}: {
  titel: string;
  seite?: "links" | "rechts";
  offen?: boolean;
  rechts?: ReactNode;
  children: ReactNode;
  ohneRand?: boolean;
}) {
  const schluessel = "captr-abschnitt-" + titel;
  const [offen, setOffen] = useState(() => {
    try {
      const w = localStorage.getItem(schluessel);
      return w === null ? anfangOffen : w === "1";
    } catch {
      return anfangOffen;
    }
  });
  const umschalten = () => {
    setOffen(!offen);
    try {
      localStorage.setItem(schluessel, offen ? "0" : "1");
    } catch {
      /* egal */
    }
  };
  return (
    <section className="border-b border-black/40">
      <div className="flex h-8 items-center bg-[#1f1f1f] px-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        {seite === "links" ? (
          <>
            <button className="flex min-w-0 flex-1 items-center gap-2 text-left text-[12.5px] text-text-2 hover:text-text" onClick={umschalten} aria-expanded={offen}>
              <Dreieck richtung={offen ? "unten" : "rechts"} className="text-text-3" />
              <span className="truncate">{titel}</span>
            </button>
            {rechts}
          </>
        ) : (
          <>
            {rechts}
            <button className="flex min-w-0 flex-1 items-center justify-end gap-2 text-right text-[12.5px] text-text-2 hover:text-text" onClick={umschalten} aria-expanded={offen}>
              <span className="truncate">{titel}</span>
              <Dreieck richtung={offen ? "unten" : "links"} className="text-text-3" />
            </button>
          </>
        )}
      </div>
      {offen && <div className={ohneRand ? "" : "px-3.5 pb-3.5 pt-2.5"}>{children}</div>}
    </section>
  );
}

// ---------- Navigator ----------

export function Navigator({ bild, rechts, children }: { bild: Bild | null | undefined; rechts?: ReactNode; children?: ReactNode }) {
  return (
    <Panel titel="Navigator" seite="links" rechts={rechts} ohneRand>
      <div className="relative flex aspect-[3/2] items-center justify-center bg-[#0d0d0d] p-2">
        {bild ? (
          <img src={vorschauUrl(bild)} alt="" className="max-h-full max-w-full object-contain shadow-[0_2px_10px_rgba(0,0,0,0.6)]" draggable={false} />
        ) : (
          <span className="text-[12px] text-text-3">Kein Foto gewählt</span>
        )}
        {children}
      </div>
    </Panel>
  );
}

// ---------- Aufnahmedaten ----------

export function exifTeile(b: Bild): string[] {
  return [
    b.iso ? `ISO ${b.iso}` : "",
    b.brennweite ? `${Math.round(b.brennweite)} mm` : "",
    b.blende ? `f/${String(b.blende).replace(".", ",")}` : "",
    formatiereBelichtung(b.belichtungszeit),
  ].filter(Boolean);
}

export function ExifZeile({ b }: { b: Bild | null | undefined }) {
  const t = b ? exifTeile(b) : [];
  return (
    <div className="zahl mt-1.5 flex justify-between px-0.5 text-[11px] text-text-3">
      {t.length ? t.map((x) => <span key={x}>{x}</span>) : <span>Keine Aufnahmedaten</span>}
    </div>
  );
}

// ---------- Histogramm aus einem Vorschaubild ----------

export function useBildHistogramm(bild: Bild | null | undefined): Histogramm | null {
  const [h, setH] = useState<Histogramm | null>(null);
  const url = bild ? miniUrl(bild) : "";
  useEffect(() => {
    if (!url) return setH(null);
    let weg = false;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      if (weg) return;
      const f = Math.min(1, 320 / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * f));
      const hh = Math.max(1, Math.round(img.naturalHeight * f));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = hh;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, w, hh);
      const d = ctx.getImageData(0, 0, w, hh).data;
      const r = new Uint32Array(256),
        g = new Uint32Array(256),
        b = new Uint32Array(256),
        l = new Uint32Array(256);
      for (let i = 0; i < d.length; i += 4) {
        r[d[i]]++;
        g[d[i + 1]]++;
        b[d[i + 2]]++;
        l[Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])]++;
      }
      setH({ r, g, b, l, anzahl: w * hh });
    };
    img.src = url;
    return () => {
      weg = true;
    };
  }, [url]);
  return h;
}

export function HistogrammPanel({ h, bild, children }: { h: Histogramm | null; bild: Bild | null | undefined; children?: ReactNode }) {
  return (
    <Panel titel="Histogramm">
      <HistogrammAnzeige h={h} />
      <ExifZeile b={bild} />
      {children}
    </Panel>
  );
}

// ---------- Filmstreifen ----------

export function Filmstreifen({
  bilder,
  aktiv,
  auswahl = [],
  quelle,
  onKlick,
  onDoppel,
}: {
  bilder: Bild[];
  aktiv?: string;
  auswahl?: string[];
  quelle: string;
  onKlick: (b: Bild, e: React.MouseEvent) => void;
  onDoppel?: (b: Bild) => void;
}) {
  const offen = useLeisten((s) => s.film);
  const umschalten = useLeisten((s) => s.umschalten);
  const nummer = bilder.findIndex((b) => b.id === aktiv);
  const name = bilder[nummer]?.name;
  return (
    <div className="shrink-0 border-t border-black/50 bg-[#161616]">
      <div className="flex h-6 items-center gap-3 border-b border-black/40 bg-[#1c1c1c] px-2 text-[11.5px] text-text-3">
        <button className="flex items-center gap-1.5 hover:text-text-2" onClick={() => umschalten("film")} title="Filmstreifen ein-/ausblenden (F6)">
          <Dreieck richtung={offen ? "unten" : "rechts"} />
        </button>
        <span className="truncate">
          <span className="text-text-2">{quelle}</span>
          <span className="mx-1.5">·</span>
          <span className="zahl">{bilder.length} Fotos</span>
          {auswahl.length > 0 && (
            <>
              <span className="mx-1.5">·</span>
              <span className="zahl">{auswahl.length} ausgewählt</span>
            </>
          )}
          {name && (
            <>
              <span className="mx-1.5">/</span>
              <span className="text-text-2">{name}</span>
            </>
          )}
        </span>
      </div>
      {offen && (
        <div className="flex h-[86px] items-center gap-1 overflow-x-auto px-1.5">
          {bilder.map((b) => {
            const an = b.id === aktiv;
            const gew = auswahl.includes(b.id);
            const farbe = farbeCss(b.farbe);
            return (
              <button
                key={b.id}
                ref={(el) => {
                  if (el && an) el.scrollIntoView({ block: "nearest", inline: "nearest" });
                }}
                onClick={(e) => onKlick(b, e)}
                onDoubleClick={() => onDoppel?.(b)}
                className={cx(
                  "relative flex h-[74px] w-[98px] shrink-0 items-center justify-center rounded-[2px] transition-colors",
                  an ? "bg-[#4a4a4a]" : gew ? "bg-[#3a3a3a]" : "bg-[#262626] hover:bg-[#2e2e2e]",
                )}
                title={b.name}
              >
                <img
                  src={miniUrl(b)}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  className={cx("max-h-[60px] max-w-[86px] object-contain shadow-[0_1px_4px_rgba(0,0,0,0.6)]", b.markierung === -1 && "opacity-35")}
                />
                {b.bewertung > 0 && (
                  <span className="absolute bottom-0.5 left-1 text-[8px] leading-none tracking-[1px] text-licht">{"★".repeat(b.bewertung)}</span>
                )}
                {farbe && <span className="absolute bottom-0 right-0 h-[3px] w-full" style={{ background: farbe }} />}
              </button>
            );
          })}
          {bilder.length === 0 && <span className="px-2 text-[12px] text-text-3">Keine Fotos in dieser Auswahl</span>}
        </div>
      )}
    </div>
  );
}
