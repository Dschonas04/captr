// Einstellungen: Anmeldung per SSO (OpenID Connect, z. B. Keycloak).

import { useEffect, useState } from "react";
import { sso, type SSOStand, type SSOStatus } from "./api";
import { Dialog, Feld, Knopf, Laedt, eingabe } from "./ui";

export function SSODialog({ status, onSchliessen }: { status: SSOStatus | null; onSchliessen: () => void }) {
  const [stand, setStand] = useState<SSOStand | null>(null);
  const [k, setK] = useState({ aktiv: false, aussteller: "", clientId: "", adresse: "", erlaubt: "" });
  const [geheimnis, setGeheimnis] = useState("");
  const [meldung, setMeldung] = useState<{ text: string; schlecht?: boolean } | null>(null);

  useEffect(() => {
    sso.lesen().then(
      (s) => {
        setStand(s);
        setK(s.einstellung);
      },
      (f: Error) => setMeldung({ text: f.message, schlecht: true }),
    );
  }, []);

  const speichern = async () => {
    if (k.aktiv && !stand?.einstellung.aktiv && !confirm("Danach kommt nur noch herein, wer sich beim Anbieter anmeldet. Weiter?")) return;
    setMeldung({ text: "Speichere …" });
    try {
      const s = await sso.speichern({ ...k, geheimnis });
      setStand(s);
      setGeheimnis("");
      if (k.aktiv && !status?.angemeldet) {
        location.href = "/sso/anmelden?ziel=" + encodeURIComponent("/" + location.hash);
        return;
      }
      setMeldung({ text: "Gespeichert." });
    } catch (f) {
      setMeldung({ text: (f as Error).message, schlecht: true });
    }
  };

  const testen = async () => {
    setMeldung({ text: "Prüfe …" });
    try {
      const t = await sso.testen(k.aussteller);
      setMeldung({ text: t.meldung, schlecht: !t.ok });
    } catch (f) {
      setMeldung({ text: (f as Error).message, schlecht: true });
    }
  };

  const feld = (name: keyof typeof k) => ({
    className: eingabe,
    value: k[name] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setK({ ...k, [name]: e.target.value }),
  });

  return (
    <Dialog titel="Einstellungen" onSchliessen={onSchliessen} breite="max-w-lg">
      {!stand ? (
        meldung ? <p className="text-[13px] text-gefahr">{meldung.text}</p> : <Laedt />
      ) : (
        <div className="space-y-3">
          <h3 className="text-[13px] font-semibold">Anmeldung (SSO)</h3>
          {stand.notaus && <p className="text-[12px] text-gefahr">Per CAPTR_SSO_AUS=1 abgeschaltet.</p>}
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={k.aktiv} onChange={(e) => setK({ ...k, aktiv: e.target.checked })} />
            Nur mit Anmeldung nutzbar
          </label>
          <Feld name="Aussteller (Issuer-URL)">
            <input {...feld("aussteller")} placeholder="https://vm-debian-docker:8180/realms/homelab" />
          </Feld>
          <Feld name="Client-ID">
            <input {...feld("clientId")} placeholder="captr" />
          </Feld>
          <Feld name="Client-Geheimnis">
            <input
              className={eingabe}
              type="password"
              autoComplete="new-password"
              value={geheimnis}
              onChange={(e) => setGeheimnis(e.target.value)}
              placeholder={stand.geheimnisDa ? "gespeichert, leer lassen zum Behalten" : "leer bei öffentlichem Client"}
            />
          </Feld>
          <Feld name="Erlaubte Konten">
            <input {...feld("erlaubt")} placeholder="leer = alle; sonst E-Mail oder Nutzername, mit Komma" />
          </Feld>
          <Feld name="Adresse von Captr">
            <input {...feld("adresse")} placeholder="leer = wie aufgerufen" />
          </Feld>
          <p className="text-[12px] text-text-2">
            Beim Anbieter als Weiterleitung eintragen: <code className="break-all">{stand.rueckweg}</code>, nach dem Abmelden:{" "}
            <code className="break-all">{stand.abmeldeweg}</code>
          </p>
          <div className="flex gap-2">
            <Knopf art="licht" onClick={speichern}>
              Speichern
            </Knopf>
            <Knopf art="rahmen" onClick={testen}>
              Verbindung testen
            </Knopf>
          </div>
          {meldung && (
            <p role="status" className={meldung.schlecht ? "text-[12px] text-gefahr" : "text-[12px] text-text-2"}>
              {meldung.text}
            </p>
          )}
          {status?.nutzer && (
            <p className="text-[12px] text-text-2">
              Angemeldet als {status.nutzer.name || status.nutzer.nutzer} ·{" "}
              <a className="underline" href="/sso/abmelden">
                Abmelden
              </a>
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}
