import { useEffect, useState } from "react";
import { Layers, Plus, Trash2 } from "lucide-react";
import { api, formatiereDatum, type Leinwand } from "../api";
import { Dialog, Feld, Knopf, Laedt, cx, eingabe, frage, melde } from "../ui";

const FORMATE: { name: string; b: number; h: number }[] = [
  { name: "Instagram Hochformat", b: 1080, h: 1350 },
  { name: "Quadrat", b: 1080, h: 1080 },
  { name: "Story", b: 1080, h: 1920 },
  { name: "Full HD", b: 1920, h: 1080 },
  { name: "4K", b: 3840, h: 2160 },
  { name: "A4 hoch, 300 dpi", b: 2480, h: 3508 },
  { name: "A4 quer, 300 dpi", b: 3508, h: 2480 },
  { name: "Postkarte, 300 dpi", b: 1748, h: 1240 },
];

function Neu({ onSchliessen }: { onSchliessen: () => void }) {
  const [name, setName] = useState("Neue Leinwand");
  const [b, setB] = useState(1080);
  const [h, setH] = useState(1350);
  const [laeuft, setLaeuft] = useState(false);
  const anlegen = async () => {
    setLaeuft(true);
    try {
      const l = await api.leinwandAnlegen({ name, breite: b, hoehe: h });
      location.hash = `#/leinwand/${l.id}`;
    } catch (e) {
      melde((e as Error).message, "fehler");
      setLaeuft(false);
    }
  };
  return (
    <Dialog titel="Neue Leinwand" onSchliessen={onSchliessen} breite="max-w-lg">
      <div className="space-y-4">
        <Feld name="Name">
          <input className={eingabe} value={name} onChange={(e) => setName(e.target.value)} />
        </Feld>
        <div className="grid grid-cols-2 gap-2">
          {FORMATE.map((f) => (
            <button
              key={f.name}
              onClick={() => {
                setB(f.b);
                setH(f.h);
              }}
              className={cx(
                "flex items-center gap-3 rounded-md border px-3 py-2 text-left",
                b === f.b && h === f.h ? "border-licht/70 bg-licht/8" : "border-linie hover:border-text-3",
              )}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center">
                <span
                  className="block border border-text-2"
                  style={{ width: (f.b / Math.max(f.b, f.h)) * 26, height: (f.h / Math.max(f.b, f.h)) * 26 }}
                />
              </span>
              <span>
                <span className="block text-[12.5px] text-text">{f.name}</span>
                <span className="zahl block text-[11px] text-text-3">
                  {f.b} × {f.h}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Feld name="Breite (px)">
            <input className={eingabe} type="number" min={16} max={12000} value={b} onChange={(e) => setB(Number(e.target.value))} />
          </Feld>
          <Feld name="Höhe (px)">
            <input className={eingabe} type="number" min={16} max={12000} value={h} onChange={(e) => setH(Number(e.target.value))} />
          </Feld>
        </div>
        <div className="flex justify-end gap-2">
          <Knopf onClick={onSchliessen}>Abbrechen</Knopf>
          <Knopf art="licht" onClick={anlegen} disabled={laeuft || b < 16 || h < 16 || b > 12000 || h > 12000}>
            Anlegen
          </Knopf>
        </div>
      </div>
    </Dialog>
  );
}

export default function Leinwaende() {
  const [liste, setListe] = useState<Leinwand[] | null>(null);
  const [neu, setNeu] = useState(false);
  useEffect(() => {
    api.leinwaende().then(setListe, (e) => {
      melde((e as Error).message, "fehler");
      setListe([]);
    });
  }, []);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl p-6">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[20px] font-semibold">Leinwand</h1>
            <p className="mt-1 max-w-xl text-[13px] text-text-2">
              Fotos zusammensetzen, freistellen, Formen und Pinselstriche darüberlegen. Die Leinwand stammt aus dem
              Open-Source-Projekt ArtCraft.
            </p>
          </div>
          <Knopf art="licht" onClick={() => setNeu(true)}>
            <Plus size={14} /> Neue Leinwand
          </Knopf>
        </div>
        {!liste ? (
          <Laedt />
        ) : liste.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-linie py-16 text-center">
            <Layers size={30} strokeWidth={1.5} className="text-licht" />
            <p className="text-[13px] text-text-2">Noch keine Leinwand angelegt.</p>
            <Knopf art="rahmen" onClick={() => setNeu(true)}>
              <Plus size={14} /> Neue Leinwand
            </Knopf>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {liste.map((l) => (
              <div key={l.id} className="group overflow-hidden rounded-lg border border-linie bg-flaeche hover:border-text-3">
                <a href={`#/leinwand/${l.id}`} className="flex aspect-[4/3] items-center justify-center bg-[#121212] p-3">
                  <img
                    src={`/api/leinwaende/${l.id}/vorschau?v=${encodeURIComponent(l.geaendert)}`}
                    alt=""
                    className="max-h-full max-w-full object-contain shadow-lg"
                    onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")}
                  />
                </a>
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <a href={`#/leinwand/${l.id}`} className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-text">{l.name}</div>
                    <div className="zahl text-[11px] text-text-3">
                      {l.breite} × {l.hoehe} · {formatiereDatum(l.geaendert)}
                    </div>
                  </a>
                  <button
                    className="p-1 text-text-3 opacity-0 hover:text-gefahr group-hover:opacity-100"
                    aria-label={`${l.name} löschen`}
                    onClick={() =>
                      frage({
                        title: "Leinwand löschen?",
                        message: `„${l.name}" wird endgültig entfernt.`,
                        primaryActionText: "Löschen",
                        onPrimaryAction: async () => {
                          await api.leinwandLoeschen(l.id);
                          setListe((x) => x?.filter((y) => y.id !== l.id) ?? null);
                        },
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {neu && <Neu onSchliessen={() => setNeu(false)} />}
    </div>
  );
}
