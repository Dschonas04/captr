import { lazy, Suspense, useEffect, useState } from "react";
import { api, sso, type SSOStatus, type Status } from "./api";
import { SSODialog } from "./sso";
import { Settings } from "lucide-react";
import Bibliothek from "./bibliothek/Bibliothek";
import Entwickeln from "./entwickeln/Entwickeln";
import { Knopf, Laedt, Meldungen, Rueckfragen, SymbolKnopf, cx, eingabe } from "./ui";

// Konva und die Leinwand erst laden, wenn jemand sie oeffnet
const Leinwaende = lazy(() => import("./leinwand/Leinwaende"));
const LeinwandEditor = lazy(() => import("./leinwand/Leinwand"));

function useWeg() {
  const [weg, setWeg] = useState(() => location.hash.slice(1) || "/");
  useEffect(() => {
    const h = () => setWeg(location.hash.slice(1) || "/");
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  return weg;
}

function Anmeldung({ onFertig }: { onFertig: () => void }) {
  const [kennwort, setKennwort] = useState("");
  const [fehler, setFehler] = useState("");
  return (
    <div className="flex h-full items-center justify-center p-6">
      <form
        className="w-full max-w-xs space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.anmelden(kennwort);
            onFertig();
          } catch {
            setFehler("Kennwort stimmt nicht");
          }
        }}
      >
        <Logo />
        <input className={eingabe} type="password" autoFocus placeholder="Kennwort" value={kennwort} onChange={(e) => setKennwort(e.target.value)} />
        {fehler && <p className="text-[12px] text-gefahr">{fehler}</p>}
        <Knopf art="licht" className="w-full">
          Anmelden
        </Knopf>
      </form>
    </div>
  );
}

function Logo() {
  return (
    <a href="#/" className="flex items-center gap-2" aria-label="Captr">
      <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden>
        <circle cx="16" cy="16" r="11" fill="none" stroke="#e0a84a" strokeWidth="3.5" />
        <circle cx="16" cy="16" r="4" fill="#e0a84a" />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight">Captr</span>
    </a>
  );
}

export default function App() {
  const weg = useWeg();
  const [status, setStatus] = useState<Status | null>(null);
  const [ssoStatus, setSsoStatus] = useState<SSOStatus | null>(null);
  const [einstellungen, setEinstellungen] = useState(false);

  const pruefe = () => api.status().then(setStatus, () => setStatus({ kennwort: false, angemeldet: true, freistellen: false }));
  useEffect(() => {
    void pruefe();
    sso.status().then(setSsoStatus, () => {});
    const h = () => setStatus((s) => (s ? { ...s, angemeldet: false } : s));
    window.addEventListener("captr:anmelden", h);
    return () => window.removeEventListener("captr:anmelden", h);
  }, []);

  if (!status)
    return (
      <div className="flex h-full items-center justify-center">
        <Laedt />
      </div>
    );
  if (!status.angemeldet) return <Anmeldung onFertig={pruefe} />;

  const teile = weg.split("/").filter(Boolean);
  const bereich = teile[0] ?? "";
  const reiter = [
    { name: "Bibliothek", href: "#/", an: bereich === "" },
    { name: "Entwickeln", href: teile[0] === "entwickeln" ? location.hash : "#/entwickeln", an: bereich === "entwickeln" },
    { name: "Leinwand", href: "#/leinwand", an: bereich === "leinwand" },
  ];

  let seite;
  if (bereich === "entwickeln" && teile[1]) seite = <Entwickeln key="e" id={teile[1]} />;
  else if (bereich === "entwickeln") seite = <OhneBild />;
  else if (bereich === "leinwand" && teile[1]) seite = <LeinwandEditor key={teile[1]} id={teile[1]} />;
  else if (bereich === "leinwand") seite = <Leinwaende />;
  else seite = <Bibliothek />;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-[52px] shrink-0 items-center gap-4 border-b border-black/60 bg-[#101010] px-4">
        <div className="flex flex-col justify-center">
          <Logo />
          {ssoStatus?.nutzer && (
            <span className="ml-7 mt-0.5 text-[11px] leading-none text-text-3">
              {ssoStatus.nutzer.name || ssoStatus.nutzer.nutzer} ·{" "}
              <a className="hover:text-text-2" href="/sso/abmelden">
                Abmelden
              </a>
            </span>
          )}
        </div>
        {/* Modulwahl rechts, durch Striche getrennt */}
        <nav className="ml-auto flex items-center" aria-label="Module">
          {reiter.map((r, i) => (
            <span key={r.name} className="flex items-center">
              {i > 0 && <span className="px-2.5 text-[15px] text-text-3/50" aria-hidden>|</span>}
              <a
                href={r.href}
                aria-current={r.an ? "page" : undefined}
                className={cx("text-[15.5px] tracking-tight transition-colors", r.an ? "font-medium text-text" : "text-text-3 hover:text-text-2")}
              >
                {r.name}
              </a>
            </span>
          ))}
        </nav>
        <SymbolKnopf className="ml-2" onClick={() => setEinstellungen(true)} aria-label="Einstellungen" title="Einstellungen">
          <Settings size={16} />
        </SymbolKnopf>
      </header>
      {einstellungen && <SSODialog status={ssoStatus} onSchliessen={() => setEinstellungen(false)} />}
      <main className="min-h-0 flex-1">
        <Suspense
          fallback={
            <div className="p-6">
              <Laedt />
            </div>
          }
        >
          {seite}
        </Suspense>
      </main>
      <Meldungen />
      <Rueckfragen />
    </div>
  );
}

function OhneBild() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-text-2">
      <p className="text-[14px]">Wähle in der Bibliothek ein Foto zum Entwickeln.</p>
      <a href="#/">
        <Knopf art="rahmen">Zur Bibliothek</Knopf>
      </a>
    </div>
  );
}
