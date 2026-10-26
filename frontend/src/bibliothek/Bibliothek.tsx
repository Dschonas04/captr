import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ban, Check, Flag, ImagePlus, Search, SlidersHorizontal, Trash2, Upload, X } from "lucide-react";
import {
  api,
  formatiereBelichtung,
  formatiereBytes,
  formatiereDatum,
  hochladen,
  miniUrl,
  vorschauUrl,
  type Bild,
  type Hochladefortschritt,
} from "../api";
import { FARBEN, Knopf, Laedt, Sterne, SymbolKnopf, cx, eingabe, farbeCss, frage, melde } from "../ui";
import { useBibliothek } from "./speicher";

export const ANNEHMBAR =
  ".jpg,.jpeg,.png,.tif,.tiff,.webp,.heic,.heif,.avif,.gif,.bmp,.cr2,.cr3,.crw,.nef,.nrw,.arw,.srf,.sr2,.dng,.raf,.orf,.rw2,.pef,.srw,.x3f,.3fr,.iiq,.mos,.erf,.kdc,.mrw,.rwl";

// Hochladen ueber die ganze Seite: Dateien hineinziehen oder waehlen.
export function useHochladen() {
  const fuegeHinzu = useBibliothek((s) => s.fuegeHinzu);
  const [fortschritt, setFortschritt] = useState<Hochladefortschritt | null>(null);
  const laeuft = useRef(false);
  const lade = useCallback(
    async (dateien: File[]) => {
      if (!dateien.length || laeuft.current) return;
      laeuft.current = true;
      setFortschritt({ datei: dateien[0].name, nummer: 1, anzahl: dateien.length, anteil: 0 });
      const erg = await hochladen(dateien, setFortschritt);
      laeuft.current = false;
      setFortschritt(null);
      if (erg.bilder.length) {
        fuegeHinzu(erg.bilder);
        melde(erg.bilder.length === 1 ? "1 Foto importiert" : `${erg.bilder.length} Fotos importiert`);
      }
      if (erg.fehler.length) melde(erg.fehler.slice(0, 3).join(" · "), "fehler");
    },
    [fuegeHinzu],
  );
  const waehle = useCallback(() => {
    const i = document.createElement("input");
    i.type = "file";
    i.multiple = true;
    i.accept = ANNEHMBAR;
    i.onchange = () => i.files && void lade(Array.from(i.files));
    i.click();
  }, [lade]);
  return { fortschritt, lade, waehle };
}

export function Fortschrittsbalken({ f }: { f: Hochladefortschritt | null }) {
  if (!f) return null;
  const gesamt = (f.nummer - 1 + f.anteil) / f.anzahl;
  return (
    <div className="fixed inset-x-0 top-0 z-[100002]">
      <div className="h-[2px] bg-licht transition-[width] duration-200" style={{ width: `${Math.max(3, gesamt * 100)}%` }} />
      <div className="absolute right-3 top-2 rounded-md border border-linie bg-feld px-3 py-1.5 text-[12px] text-text-2 shadow-xl">
        {f.anteil >= 1 ? "Entwickle" : "Lade"} {f.nummer}/{f.anzahl} · <span className="text-text">{f.datei}</span>
      </div>
    </div>
  );
}

function Markierung({ m }: { m: number }) {
  if (m === 1) return <Flag size={12} className="text-text" fill="currentColor" aria-label="ausgewählt" />;
  if (m === -1) return <Ban size={12} className="text-gefahr" aria-label="abgelehnt" />;
  return null;
}

function Kachel({
  b,
  gewaehlt,
  aktiv,
  groesse,
  onKlick,
  onDoppel,
}: {
  b: Bild;
  gewaehlt: boolean;
  aktiv: boolean;
  groesse: number;
  onKlick: (e: React.MouseEvent) => void;
  onDoppel: () => void;
}) {
  const farbe = farbeCss(b.farbe);
  return (
    <div
      role="gridcell"
      aria-selected={gewaehlt}
      data-id={b.id}
      onClick={onKlick}
      onDoubleClick={onDoppel}
      className={cx(
        "group relative flex cursor-default flex-col rounded-[5px] border bg-flaeche transition-colors",
        gewaehlt ? "border-white/25 bg-feld-hell" : "border-transparent hover:bg-feld",
        aktiv && "border-licht/70",
      )}
      style={{ width: groesse }}
    >
      <div className="relative flex items-center justify-center" style={{ height: groesse - 34 }}>
        <img
          src={miniUrl(b)}
          alt={b.name}
          loading="lazy"
          decoding="async"
          draggable={false}
          className={cx(
            "max-h-[calc(100%-14px)] max-w-[calc(100%-14px)] object-contain shadow-[0_2px_8px_rgba(0,0,0,0.5)]",
            b.markierung === -1 && "opacity-35",
          )}
        />
        <div className="absolute left-2 top-2 flex items-center gap-1">
          {b.art === "raw" && (
            <span className="rounded-[3px] bg-black/55 px-1 py-[1px] text-[9px] font-semibold tracking-wider text-text-2">RAW</span>
          )}
          {b.bearbeitet && <SlidersHorizontal size={11} className="text-licht drop-shadow" aria-label="bearbeitet" />}
        </div>
      </div>
      <div className="flex h-[34px] items-center justify-between gap-1 px-2">
        <Sterne wert={b.bewertung} klein />
        <div className="flex items-center gap-1.5">
          <Markierung m={b.markierung} />
          {farbe && <span className="h-2.5 w-2.5 rounded-full" style={{ background: farbe }} />}
        </div>
      </div>
    </div>
  );
}

function Filterleiste({ anzahl }: { anzahl: number }) {
  const { filter, setzeFilter } = useBibliothek();
  const [suche, setSuche] = useState(filter.suche ?? "");
  useEffect(() => {
    const t = setTimeout(() => suche !== (filter.suche ?? "") && setzeFilter({ suche }), 250);
    return () => clearTimeout(t);
  }, [suche, filter.suche, setzeFilter]);
  const seg = (aktiv: boolean) =>
    cx("h-7 rounded-[5px] px-2.5 text-[12px] transition-colors", aktiv ? "bg-feld-hell text-text" : "text-text-2 hover:text-text");
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-linie px-4 py-2.5">
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3" />
        <input
          className={cx(eingabe, "h-8 w-52 pl-8")}
          placeholder="Name, Kamera, Objektiv"
          value={suche}
          onChange={(e) => setSuche(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[12px] text-text-3">ab</span>
        <Sterne wert={filter.bewertung ?? 0} onChange={(v) => setzeFilter({ bewertung: v })} />
      </div>
      <div className="flex rounded-md bg-feld p-[2px]">
        {(
          [
            ["", "Alle"],
            ["ohne-abgelehnte", "Ohne Abgelehnte"],
            ["ausgewaehlt", "Ausgewählt"],
            ["abgelehnt", "Abgelehnt"],
          ] as const
        ).map(([w, n]) => (
          <button key={w} className={seg((filter.markierung ?? "") === w)} onClick={() => setzeFilter({ markierung: w })}>
            {n}
          </button>
        ))}
      </div>
      <button
        className={cx(
          "h-7 rounded-md border px-2.5 text-[11px] font-semibold tracking-wider",
          filter.art === "raw" ? "border-licht/60 text-licht" : "border-linie text-text-3 hover:text-text-2",
        )}
        onClick={() => setzeFilter({ art: filter.art === "raw" ? "" : "raw" })}
        aria-pressed={filter.art === "raw"}
      >
        RAW
      </button>
      <div className="flex items-center gap-1.5">
        {FARBEN.map((f) => (
          <button
            key={f.wert}
            title={f.name}
            aria-label={`Farbe ${f.name}`}
            aria-pressed={filter.farbe === f.wert}
            onClick={() => setzeFilter({ farbe: filter.farbe === f.wert ? "" : f.wert })}
            className={cx(
              "h-3.5 w-3.5 rounded-full transition-transform hover:scale-110",
              filter.farbe === f.wert ? "ring-2 ring-white/80 ring-offset-2 ring-offset-grund" : "opacity-70",
            )}
            style={{ background: f.css }}
          />
        ))}
      </div>
      <div className="ml-auto flex items-center gap-3">
        <span className="zahl text-[12px] text-text-3">{anzahl} Fotos</span>
        <select
          className="h-8 rounded-md border border-linie bg-feld px-2 text-[12px] text-text-2 outline-none"
          value={filter.ordnung ?? "aufgenommen"}
          onChange={(e) => setzeFilter({ ordnung: e.target.value as never })}
          aria-label="Sortierung"
        >
          <option value="aufgenommen">Aufnahmedatum</option>
          <option value="angelegt">Importiert</option>
          <option value="name">Name</option>
          <option value="bewertung">Bewertung</option>
        </select>
      </div>
    </div>
  );
}

function Info({ b, anzahl }: { b: Bild; anzahl: number }) {
  const { aendere, entferne } = useBibliothek();
  const zeilen: [string, string][] = [
    ["Aufgenommen", formatiereDatum(b.aufgenommen)],
    ["Kamera", b.kamera],
    ["Objektiv", b.objektiv],
    [
      "Belichtung",
      [b.brennweite ? `${Math.round(b.brennweite)} mm` : "", b.blende ? `f/${b.blende}` : "", formatiereBelichtung(b.belichtungszeit), b.iso ? `ISO ${b.iso}` : ""]
        .filter(Boolean)
        .join("  ·  "),
    ],
    ["Größe", `${b.breite} × ${b.hoehe} · ${formatiereBytes(b.bytes)}`],
    ["Importiert", formatiereDatum(b.angelegt)],
  ];
  const ids = useBibliothek((s) => s.auswahl);
  const alle = ids.length > 1 ? ids : [b.id];
  return (
    <aside className="hidden w-[300px] shrink-0 flex-col overflow-y-auto border-l border-linie bg-flaeche lg:flex">
      <div className="flex aspect-[4/3] items-center justify-center bg-[#0d0d0d] p-3">
        <img src={vorschauUrl(b)} alt="" className="max-h-full max-w-full object-contain" />
      </div>
      <div className="space-y-4 p-4">
        <div>
          <div className="truncate text-[14px] font-medium" title={b.name}>
            {b.name}
          </div>
          {anzahl > 1 && <div className="mt-0.5 text-[12px] text-licht">{anzahl} Fotos gewählt – Änderungen gelten für alle</div>}
        </div>
        <div className="flex items-center justify-between">
          <Sterne wert={b.bewertung} onChange={(v) => aendere(alle, { bewertung: v })} />
          <div className="flex items-center gap-1">
            <SymbolKnopf aktiv={b.markierung === 1} title="Auswählen (P)" onClick={() => aendere(alle, { markierung: b.markierung === 1 ? 0 : 1 })}>
              <Flag size={15} />
            </SymbolKnopf>
            <SymbolKnopf aktiv={b.markierung === -1} title="Ablehnen (X)" onClick={() => aendere(alle, { markierung: b.markierung === -1 ? 0 : -1 })}>
              <Ban size={15} />
            </SymbolKnopf>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {FARBEN.map((f) => (
            <button
              key={f.wert}
              title={f.name}
              aria-label={`Farbe ${f.name}`}
              onClick={() => aendere(alle, { farbe: b.farbe === f.wert ? "" : f.wert })}
              className={cx("h-4 w-4 rounded-full", b.farbe === f.wert ? "ring-2 ring-white/80 ring-offset-2 ring-offset-flaeche" : "opacity-60 hover:opacity-100")}
              style={{ background: f.css }}
            />
          ))}
        </div>
        <dl className="space-y-2 text-[12.5px]">
          {zeilen
            .filter(([, w]) => w)
            .map(([n, w]) => (
              <div key={n}>
                <dt className="text-[11px] uppercase tracking-wider text-text-3">{n}</dt>
                <dd className="text-text-2">{w}</dd>
              </div>
            ))}
        </dl>
        <div className="flex flex-wrap gap-2 pt-2">
          <a href={`#/entwickeln/${b.id}`} className="inline-flex">
            <Knopf art="licht">
              <SlidersHorizontal size={14} /> Entwickeln
            </Knopf>
          </a>
          <a href={`/api/bilder/${b.id}/original`} className="inline-flex">
            <Knopf art="rahmen">Original</Knopf>
          </a>
          <Knopf
            art="gefahr"
            onClick={() =>
              frage({
                title: alle.length > 1 ? `${alle.length} Fotos löschen?` : "Foto löschen?",
                message: "Original, Einstellungen und Vorschauen werden entfernt.",
                primaryActionText: "Löschen",
                onPrimaryAction: async () => {
                  for (const id of alle) {
                    try {
                      await api.loeschen(id);
                      entferne(id);
                    } catch (e) {
                      melde((e as Error).message, "fehler");
                    }
                  }
                },
              })
            }
          >
            <Trash2 size={14} /> Löschen
          </Knopf>
        </div>
      </div>
    </aside>
  );
}

export default function Bibliothek() {
  const { bilder, geladen, auswahl, waehle, aendere, laden, entferne } = useBibliothek();
  const { fortschritt, lade, waehle: dateienWaehlen } = useHochladen();
  const [ziehen, setZiehen] = useState(false);
  const [groesse, setGroesse] = useState(() => {
    try {
      return Number(localStorage.getItem("captr-kachel")) || 190;
    } catch {
      return 190;
    }
  });
  const raster = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void laden();
  }, [laden]);

  useEffect(() => {
    try {
      localStorage.setItem("captr-kachel", String(groesse));
    } catch {
      /* egal */
    }
  }, [groesse]);

  const aktiv = useMemo(() => bilder.find((b) => b.id === auswahl[0]), [bilder, auswahl]);

  // Tastatur wie in Lightroom
  useEffect(() => {
    const taste = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || document.querySelector("[role=dialog]")) return;
      const ids = auswahl.length ? auswahl : [];
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        useBibliothek.setState({ auswahl: bilder.map((b) => b.id) });
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[0-5]$/.test(e.key) && ids.length) return void aendere(ids, { bewertung: Number(e.key) });
      const farbTaste: Record<string, string> = { "6": "rot", "7": "gelb", "8": "gruen", "9": "blau" };
      if (farbTaste[e.key] && ids.length) {
        const f = farbTaste[e.key];
        return void aendere(ids, { farbe: aktiv?.farbe === f ? "" : (f as never) });
      }
      const k = e.key.toLowerCase();
      if (k === "p" && ids.length) return void aendere(ids, { markierung: 1 });
      if (k === "x" && ids.length) return void aendere(ids, { markierung: -1 });
      if (k === "u" && ids.length) return void aendere(ids, { markierung: 0 });
      if ((k === "enter" || k === "d") && aktiv) {
        location.hash = `#/entwickeln/${aktiv.id}`;
        return;
      }
      if ((k === "delete" || k === "backspace") && ids.length) {
        frage({
          title: ids.length > 1 ? `${ids.length} Fotos löschen?` : "Foto löschen?",
          message: "Original, Einstellungen und Vorschauen werden entfernt.",
          primaryActionText: "Löschen",
          onPrimaryAction: async () => {
            for (const id of ids) {
              try {
                await api.loeschen(id);
                entferne(id);
              } catch (err) {
                melde((err as Error).message, "fehler");
              }
            }
          },
        });
        return;
      }
      if (["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(k) && bilder.length) {
        e.preventDefault();
        const i = Math.max(0, bilder.findIndex((b) => b.id === auswahl[0]));
        const breite = raster.current?.clientWidth ?? 800;
        const proZeile = Math.max(1, Math.floor((breite - 24) / (groesse + 8)));
        const schritt = { arrowleft: -1, arrowright: 1, arrowup: -proZeile, arrowdown: proZeile }[k]!;
        const n = Math.min(bilder.length - 1, Math.max(0, i + schritt));
        waehle(bilder[n].id, e.shiftKey ? "bereich" : "einzeln");
        raster.current?.querySelector(`[data-id="${bilder[n].id}"]`)?.scrollIntoView({ block: "nearest" });
      }
    };
    window.addEventListener("keydown", taste);
    return () => window.removeEventListener("keydown", taste);
  }, [auswahl, bilder, aendere, aktiv, waehle, groesse, entferne]);

  const ablegen = (e: React.DragEvent) => {
    e.preventDefault();
    setZiehen(false);
    void lade(Array.from(e.dataTransfer.files));
  };

  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setZiehen(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setZiehen(false)}
      onDrop={ablegen}
    >
      <Fortschrittsbalken f={fortschritt} />
      <Filterleiste anzahl={bilder.length} />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            ref={raster}
            role="grid"
            aria-label="Fotos"
            className="min-h-0 flex-1 overflow-y-auto p-3"
            onClick={(e) => e.target === e.currentTarget && useBibliothek.setState({ auswahl: [] })}
          >
            {!geladen ? (
              <div className="p-6">
                <Laedt />
              </div>
            ) : bilder.length === 0 ? (
              <Leer onImport={dateienWaehlen} gefiltert={Object.values(useBibliothek.getState().filter).some(Boolean)} />
            ) : (
              <div className="flex flex-wrap content-start gap-2">
                {bilder.map((b) => (
                  <Kachel
                    key={b.id}
                    b={b}
                    groesse={groesse}
                    gewaehlt={auswahl.includes(b.id)}
                    aktiv={auswahl[0] === b.id && auswahl.length > 1}
                    onKlick={(e) => waehle(b.id, e.shiftKey ? "bereich" : e.ctrlKey || e.metaKey ? "dazu" : "einzeln")}
                    onDoppel={() => (location.hash = `#/entwickeln/${b.id}`)}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="flex h-10 shrink-0 items-center justify-between border-t border-linie px-4">
            <Knopf art="rahmen" onClick={dateienWaehlen}>
              <Upload size={14} /> Importieren
            </Knopf>
            <div className="flex items-center gap-3 text-[12px] text-text-3">
              {auswahl.length > 1 && (
                <span className="flex items-center gap-1 text-text-2">
                  <Check size={13} /> {auswahl.length} gewählt
                  <button className="ml-1 text-text-3 hover:text-text" onClick={() => useBibliothek.setState({ auswahl: [] })} aria-label="Auswahl aufheben">
                    <X size={13} />
                  </button>
                </span>
              )}
              <span className="hidden sm:inline">Größe</span>
              <input
                type="range"
                className="regler w-28"
                min={120}
                max={360}
                value={groesse}
                onChange={(e) => setGroesse(Number(e.target.value))}
                aria-label="Kachelgröße"
              />
            </div>
          </div>
        </div>
        {aktiv && <Info b={aktiv} anzahl={auswahl.length} />}
      </div>
      {ziehen && (
        <div className="pointer-events-none absolute inset-2 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-licht/70 bg-black/60">
          <div className="flex flex-col items-center gap-2 text-licht">
            <ImagePlus size={36} strokeWidth={1.5} />
            <span className="text-[15px] font-medium">Fotos hier ablegen</span>
            <span className="text-[12px] text-text-2">RAW, JPEG, PNG, TIFF, WebP, HEIC</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Leer({ onImport, gefiltert }: { onImport: () => void; gefiltert: boolean }) {
  if (gefiltert)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-text-3">
        <p>Kein Foto passt zum Filter.</p>
        <Knopf art="rahmen" onClick={() => useBibliothek.getState().setzeFilter({ bewertung: 0, markierung: "", art: "", farbe: "", suche: "" })}>
          Filter zurücksetzen
        </Knopf>
      </div>
    );
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-linie bg-flaeche text-licht">
        <ImagePlus size={28} strokeWidth={1.5} />
      </div>
      <div>
        <h2 className="text-[17px] font-semibold">Noch keine Fotos</h2>
        <p className="mt-1 max-w-sm text-[13px] text-text-2">
          Zieh Fotos in dieses Fenster oder wähle sie aus. Captr liest RAW-Dateien fast aller Kameras, dazu JPEG, PNG, TIFF, WebP und HEIC.
        </p>
      </div>
      <Knopf art="licht" onClick={onImport}>
        <Upload size={14} /> Fotos importieren
      </Knopf>
    </div>
  );
}
