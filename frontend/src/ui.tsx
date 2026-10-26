// Kleine Bausteine, die ueberall gebraucht werden.

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { create } from "zustand";
import { Star, X } from "lucide-react";
import { twMerge } from "tailwind-merge";

export const cx = (...k: (string | false | null | undefined)[]) => twMerge(k.filter(Boolean).join(" "));

// ---------- Knoepfe ----------

type KnopfArt = "leise" | "licht" | "rahmen" | "gefahr";

export function Knopf({
  art = "leise",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { art?: KnopfArt }) {
  const stil: Record<KnopfArt, string> = {
    leise: "text-text-2 hover:text-text hover:bg-white/6",
    licht: "bg-licht text-[#1a1408] font-semibold hover:bg-licht-hell",
    rahmen: "border border-linie text-text hover:border-text-3 hover:bg-white/4",
    gefahr: "text-gefahr hover:bg-gefahr/12",
  };
  return (
    <button
      className={cx(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] transition-colors disabled:opacity-40",
        stil[art],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function SymbolKnopf({
  aktiv,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { aktiv?: boolean }) {
  return (
    <button
      className={cx(
        "inline-flex h-8 w-8 items-center justify-center rounded-md text-text-2 transition-colors hover:bg-white/6 hover:text-text disabled:opacity-40",
        aktiv && "bg-licht/15 text-licht hover:bg-licht/20 hover:text-licht",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---------- Regler ----------

export function Regler({
  name,
  wert,
  min,
  max,
  schritt = 1,
  standard = 0,
  onChange,
  onEnde,
  format,
  spur,
}: {
  name: string;
  wert: number;
  min: number;
  max: number;
  schritt?: number;
  standard?: number;
  onChange: (v: number) => void;
  onEnde?: () => void;
  format?: (v: number) => string;
  spur?: string; // CSS-Hintergrund der Spur, z. B. Farbverlauf fuer Temperatur
}) {
  const [bearbeiten, setBearbeiten] = useState(false);
  const anzeige = format ? format(wert) : wert > 0 && min < 0 ? `+${wert}` : String(wert);
  const geaendert = Math.abs(wert - standard) > 1e-9;
  return (
    <div className="group grid grid-cols-[1fr_auto] items-center gap-x-2 py-[3px]">
      <label
        className={cx("cursor-default select-none text-[12.5px] text-text-2", geaendert && "text-text")}
        onDoubleClick={() => {
          onChange(standard);
          onEnde?.();
        }}
        title="Doppelklick setzt zurück"
      >
        {name}
      </label>
      {bearbeiten ? (
        <input
          autoFocus
          className="zahl w-14 rounded bg-feld px-1 text-right text-[12px] text-text outline-none ring-1 ring-licht/50"
          defaultValue={String(wert)}
          onBlur={(e) => {
            const v = parseFloat(e.target.value.replace(",", "."));
            if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
            setBearbeiten(false);
            onEnde?.();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setBearbeiten(false);
            e.stopPropagation();
          }}
        />
      ) : (
        <button
          className={cx("zahl w-14 text-right text-[12px] text-text-3 hover:text-text", geaendert && "text-text-2")}
          onClick={() => setBearbeiten(true)}
          tabIndex={-1}
        >
          {anzeige}
        </button>
      )}
      <input
        type="range"
        className="regler col-span-2"
        style={spur ? ({ "--spur": spur } as React.CSSProperties) : undefined}
        min={min}
        max={max}
        step={schritt}
        value={wert}
        aria-label={name}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onPointerUp={() => onEnde?.()}
        onKeyUp={() => onEnde?.()}
        onDoubleClick={() => {
          onChange(standard);
          onEnde?.();
        }}
      />
    </div>
  );
}

// ---------- Sterne ----------

export function Sterne({
  wert,
  onChange,
  klein,
}: {
  wert: number;
  onChange?: (v: number) => void;
  klein?: boolean;
}) {
  const g = klein ? 11 : 14;
  return (
    <div className="flex items-center gap-[1px]" role={onChange ? "radiogroup" : undefined} aria-label="Bewertung">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          disabled={!onChange}
          onClick={(e) => {
            e.stopPropagation();
            onChange?.(wert === n ? 0 : n);
          }}
          className={cx("p-[1px] disabled:cursor-default", n <= wert ? "text-licht" : "text-text-3/50", onChange && "hover:text-licht-hell")}
          aria-label={`${n} Sterne`}
        >
          <Star size={g} fill={n <= wert ? "currentColor" : "none"} strokeWidth={1.8} />
        </button>
      ))}
    </div>
  );
}

export const FARBEN: { wert: "rot" | "gelb" | "gruen" | "blau" | "lila"; name: string; css: string }[] = [
  { wert: "rot", name: "Rot", css: "#d9534f" },
  { wert: "gelb", name: "Gelb", css: "#e6c84a" },
  { wert: "gruen", name: "Grün", css: "#5cae6b" },
  { wert: "blau", name: "Blau", css: "#4f8fd9" },
  { wert: "lila", name: "Lila", css: "#9a6ad9" },
];

export const farbeCss = (f: string) => FARBEN.find((x) => x.wert === f)?.css;

// ---------- Meldungen ----------

interface Meldung {
  id: number;
  text: string;
  art: "info" | "fehler";
}

export const useMeldungen = create<{ liste: Meldung[]; zeige: (text: string, art?: Meldung["art"]) => void; weg: (id: number) => void }>(
  (set, get) => ({
    liste: [],
    zeige: (text, art = "info") => {
      const id = Date.now() + Math.random();
      set({ liste: [...get().liste.slice(-3), { id, text, art }] });
      setTimeout(() => get().weg(id), art === "fehler" ? 7000 : 3500);
    },
    weg: (id) => set({ liste: get().liste.filter((m) => m.id !== id) }),
  }),
);

export const melde = (text: string, art?: Meldung["art"]) => useMeldungen.getState().zeige(text, art);

export function Meldungen() {
  const { liste, weg } = useMeldungen();
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[100000] flex -translate-x-1/2 flex-col items-center gap-2">
      {liste.map((m) => (
        <div
          key={m.id}
          role="status"
          className={cx(
            "pointer-events-auto flex max-w-[90vw] items-center gap-3 rounded-lg border px-4 py-2.5 text-[13px] shadow-2xl",
            m.art === "fehler" ? "border-gefahr/40 bg-[#2a1715] text-[#f3c4bd]" : "border-linie bg-feld text-text",
          )}
        >
          <span>{m.text}</span>
          <button onClick={() => weg(m.id)} className="text-text-3 hover:text-text" aria-label="Schließen">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------- Dialog ----------

export function Dialog({
  titel,
  children,
  onSchliessen,
  breite = "max-w-md",
}: {
  titel: string;
  children: ReactNode;
  onSchliessen: () => void;
  breite?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const taste = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onSchliessen();
      }
    };
    window.addEventListener("keydown", taste, true);
    ref.current?.querySelector<HTMLElement>("input, button")?.focus();
    return () => window.removeEventListener("keydown", taste, true);
  }, [onSchliessen]);
  return (
    <div
      className="fixed inset-0 z-[100001] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onSchliessen()}
    >
      <div ref={ref} role="dialog" aria-label={titel} className={cx("w-full rounded-xl border border-linie bg-flaeche shadow-2xl", breite)}>
        <div className="flex items-center justify-between border-b border-linie px-5 py-3">
          <h2 className="text-[15px] font-semibold">{titel}</h2>
          <SymbolKnopf onClick={onSchliessen} aria-label="Schließen">
            <X size={16} />
          </SymbolKnopf>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Feld({ name, children }: { name: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] text-text-2">{name}</span>
      {children}
    </label>
  );
}

export const eingabe =
  "h-9 w-full rounded-md border border-linie bg-feld px-3 text-[13px] text-text outline-none placeholder:text-text-3 focus:border-licht/60";

// Rueckfrage, die auch die ArtCraft-Leinwand ueber ein Ereignis ausloest.
export interface RueckfrageDaten {
  title: string;
  message?: ReactNode;
  primaryActionText: string;
  onPrimaryAction: () => void;
}

export function frage(d: RueckfrageDaten) {
  window.dispatchEvent(new CustomEvent("captr:rueckfrage", { detail: d }));
}

export function Rueckfragen() {
  const [d, setD] = useState<RueckfrageDaten | null>(null);
  useEffect(() => {
    const h = (e: Event) => setD((e as CustomEvent<RueckfrageDaten>).detail);
    window.addEventListener("captr:rueckfrage", h);
    return () => window.removeEventListener("captr:rueckfrage", h);
  }, []);
  if (!d) return null;
  return (
    <Dialog titel={d.title} onSchliessen={() => setD(null)}>
      <div className="text-[13px] text-text-2">{d.message}</div>
      <div className="mt-5 flex justify-end gap-2">
        <Knopf onClick={() => setD(null)}>Abbrechen</Knopf>
        <Knopf
          art="licht"
          className="bg-gefahr text-white hover:bg-gefahr/85"
          onClick={() => {
            d.onPrimaryAction();
            setD(null);
          }}
        >
          {d.primaryActionText}
        </Knopf>
      </div>
    </Dialog>
  );
}

export function Laedt({ text = "Lädt …" }: { text?: string }) {
  return (
    <div className="flex items-center gap-2 text-[13px] text-text-3">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-text-3 border-t-transparent" />
      {text}
    </div>
  );
}
