// Die Leinwand: ArtCraft-Bausteine (PaintSurface, SideToolbar, Kontextmenue,
// Szenenspeicher) in einem Captr-Rahmen. Statt KI-Generierung gibt es hier
// Bilder aus der Bibliothek, Freistellen per rembg im Heimnetz, Speichern
// auf dem Captr-Dienst und Export als PNG oder JPEG.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import { ArrowLeft, Download, ImagePlus, Maximize, Save, Scissors } from "lucide-react";
import { api, miniUrl, vorschauUrl, type Bild, type Leinwand as LeinwandDaten } from "../api";
import { useBibliothek } from "../bibliothek/speicher";
import { Dialog, Knopf, Laedt, SymbolKnopf, cx, eingabe, melde } from "../ui";
import { PaintSurface, DRAW_LAYER_ID } from "./artcraft/PaintSurface";
import SideToolbar from "./artcraft/components/ui/SideToolbar";
import { ContextMenuContainer } from "./artcraft/components/ui/ContextMenu";
import { usePagedrawKeybinds } from "./artcraft/hooks/usePagedrawKeybinds";
import { useSceneStore } from "./artcraft/stores/SceneState";
import { Node } from "./artcraft/Node";

function BildWahl({ onWahl, onSchliessen }: { onWahl: (b: Bild[]) => void; onSchliessen: () => void }) {
  const { bilder, geladen, laden } = useBibliothek();
  const [gewaehlt, setGewaehlt] = useState<string[]>([]);
  useEffect(() => {
    if (!geladen) void laden();
  }, [geladen, laden]);
  return (
    <Dialog titel="Fotos aus der Bibliothek" onSchliessen={onSchliessen} breite="max-w-3xl">
      {!geladen ? (
        <Laedt />
      ) : bilder.length === 0 ? (
        <p className="text-[13px] text-text-2">Die Bibliothek ist leer.</p>
      ) : (
        <div className="grid max-h-[60vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-5">
          {bilder.map((b) => {
            const an = gewaehlt.includes(b.id);
            return (
              <button
                key={b.id}
                onClick={() => setGewaehlt(an ? gewaehlt.filter((x) => x !== b.id) : [...gewaehlt, b.id])}
                onDoubleClick={() => onWahl([b])}
                className={cx(
                  "flex aspect-square items-center justify-center rounded-md border bg-[#121212] p-1",
                  an ? "border-licht" : "border-transparent hover:border-linie",
                )}
                aria-pressed={an}
                title={b.name}
              >
                <img src={miniUrl(b)} alt={b.name} loading="lazy" className="max-h-full max-w-full object-contain" />
              </button>
            );
          })}
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Knopf onClick={onSchliessen}>Abbrechen</Knopf>
        <Knopf art="licht" disabled={!gewaehlt.length} onClick={() => onWahl(bilder.filter((b) => gewaehlt.includes(b.id)))}>
          {gewaehlt.length > 1 ? `${gewaehlt.length} Fotos einfügen` : "Einfügen"}
        </Knopf>
      </div>
    </Dialog>
  );
}

function ExportDialog({ name, onExport, onSchliessen }: { name: string; onExport: (typ: "image/png" | "image/jpeg", faktor: number) => void; onSchliessen: () => void }) {
  const [typ, setTyp] = useState<"image/png" | "image/jpeg">("image/png");
  const [faktor, setFaktor] = useState(1);
  return (
    <Dialog titel={`„${name}" exportieren`} onSchliessen={onSchliessen}>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-[12px] text-text-2">Format</span>
          <select className={eingabe} value={typ} onChange={(e) => setTyp(e.target.value as never)}>
            <option value="image/png">PNG (mit Transparenz)</option>
            <option value="image/jpeg">JPEG</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] text-text-2">Größe</span>
          <select className={eingabe} value={faktor} onChange={(e) => setFaktor(Number(e.target.value))}>
            <option value={0.5}>50 %</option>
            <option value={1}>100 %</option>
            <option value={2}>200 %</option>
          </select>
        </label>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Knopf onClick={onSchliessen}>Abbrechen</Knopf>
        <Knopf art="licht" onClick={() => onExport(typ, faktor)}>
          <Download size={14} /> Exportieren
        </Knopf>
      </div>
    </Dialog>
  );
}

export default function LeinwandEditor({ id }: { id: string }) {
  const [daten, setDaten] = useState<LeinwandDaten | null>(null);
  const [fehler, setFehler] = useState("");
  const [name, setName] = useState("");
  const [geaendert, setGeaendert] = useState(false);
  const [speichert, setSpeichert] = useState(false);
  const [freistellen, setFreistellen] = useState(false);
  const [wahl, setWahl] = useState(false);
  const [exportieren, setExportieren] = useState(false);
  const [freistellenDa, setFreistellenDa] = useState(true);

  const stageRef = useRef<Konva.Stage>(null);
  const transformerRefs = useRef<{ [key: string]: Konva.Transformer }>({});
  const baseImageRef = useRef<Konva.Image>(null);
  const bereit = useRef(false);

  const s = useSceneStore();
  const {
    drawNodes,
    inpaintLineNodes,
    selectedNodeIds,
    activeTool,
    brushColor,
    brushSize,
    eraserSize,
    fillColor,
    currentShape,
    inpaintOperation,
    inpaintBrushSize,
  } = s;

  // ---------- Laden ----------

  useEffect(() => {
    let abbruch = false;
    bereit.current = false;
    api.status().then((st) => setFreistellenDa(st.freistellen), () => {});
    api.leinwand(id).then(
      (l) => {
        if (abbruch) return;
        const st = useSceneStore.getState();
        st.RESET();
        st.setBaseImageInfo({ url: "", mediaToken: l.id, isBlankCanvas: true, blankCanvasWidth: l.breite, blankCanvasHeight: l.hoehe });
        if (l.szene) st.loadSceneFromString(l.szene);
        setDaten(l);
        setName(l.name);
        setGeaendert(false);
        requestAnimationFrame(() => {
          einpassen();
          bereit.current = true;
        });
      },
      (e) => setFehler((e as Error).message),
    );
    return () => {
      abbruch = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Aenderungen merken (fuer den Speichern-Hinweis)
  useEffect(() => {
    if (bereit.current) setGeaendert(true);
  }, [drawNodes, fillColor]);

  // ---------- Ansicht ----------

  const einpassen = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const { width: cw, height: ch } = useSceneStore.getState().getAspectRatioDimensions();
    const w = stage.container().offsetWidth;
    const h = stage.container().offsetHeight;
    const rand = 56;
    const m = Math.min((w - rand * 2) / cw, (h - rand * 2) / ch, 1);
    stage.scale({ x: m, y: m });
    stage.position({ x: (w - cw * m) / 2, y: (h - ch * m) / 2 });
    stage.batchDraw();
  }, []);

  // ---------- Bilder einfuegen ----------

  const platziere = useCallback((url: string, b: number, h: number, versatz = 0) => {
    const { width: cw, height: ch } = useSceneStore.getState().getAspectRatioDimensions();
    const m = Math.min((cw * 0.8) / b, (ch * 0.8) / h, 1);
    const w = b * m;
    const hh = h * m;
    const node = new Node({
      id: Math.random().toString(36).slice(2, 9),
      type: "image",
      x: (cw - w) / 2 + versatz,
      y: (ch - hh) / 2 + versatz,
      width: w,
      height: hh,
      fill: "transparent",
      imageUrl: url,
    });
    node.setImageFromUrl(url).then(
      () => useSceneStore.getState().addNode(node),
      () => melde("Bild ließ sich nicht laden", "fehler"),
    );
  }, []);

  const ausBibliothek = (liste: Bild[]) => {
    setWahl(false);
    liste.forEach((b, i) => {
      const url = vorschauUrl(b);
      const img = new Image();
      img.onload = () => platziere(url, img.naturalWidth, img.naturalHeight, i * 24);
      img.src = url;
    });
  };

  const ausDateien = useCallback((dateien: File[]) => {
    const { width: cw, height: ch } = useSceneStore.getState().getAspectRatioDimensions();
    dateien
      .filter((f) => f.type.startsWith("image/"))
      .forEach((f, i) => {
        const img = new Image();
        const url = URL.createObjectURL(f);
        img.onload = () => {
          const m = Math.min((cw * 0.8) / img.naturalWidth, (ch * 0.8) / img.naturalHeight, 1);
          const w = img.naturalWidth * m;
          const h = img.naturalHeight * m;
          useSceneStore.getState().createImageFromFile((cw - w) / 2 + i * 24, (ch - h) / 2 + i * 24, f, w, h);
          URL.revokeObjectURL(url);
        };
        img.src = url;
      });
  }, []);

  const dateiWaehlen = useCallback(() => {
    const i = document.createElement("input");
    i.type = "file";
    i.accept = "image/*";
    i.multiple = true;
    i.onchange = () => i.files && ausDateien(Array.from(i.files));
    i.click();
  }, [ausDateien]);

  // ---------- Freistellen ----------

  const stelleFrei = useCallback(async () => {
    const st = useSceneStore.getState();
    const node = st.drawNodes.find((n) => st.selectedNodeIds.includes(n.id) && n.type === "image") as Node | undefined;
    if (!node?.imageElement) {
      melde("Erst ein Bild auf der Leinwand auswählen", "fehler");
      return;
    }
    setFreistellen(true);
    try {
      const img = node.imageElement;
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext("2d")!.drawImage(img, 0, 0);
      const blob = await new Promise<Blob>((ok, nein) => c.toBlob((b) => (b ? ok(b) : nein(new Error("Bild nicht lesbar"))), "image/png"));
      const erg = await api.freistellen(blob);
      await node.setImageFromUrl(erg.url);
      useSceneStore.getState().updateNode(node.id, { imageUrl: erg.url, imageFile: undefined }, true);
      melde("Freigestellt");
    } catch (e) {
      melde("Freistellen fehlgeschlagen: " + (e as Error).message, "fehler");
    } finally {
      setFreistellen(false);
    }
  }, []);

  // ---------- Speichern und Export ----------

  const zeichnung = useCallback((faktor: number, hintergrund: boolean): HTMLCanvasElement | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const ebene = stage.getLayers().find((l) => l.id() === DRAW_LAYER_ID);
    if (!ebene) return null;
    const { width: cw, height: ch } = useSceneStore.getState().getAspectRatioDimensions();
    const st = useSceneStore.getState();
    const auswahl = st.selectedNodeIds;
    st.selectNode(null); // keine Anfasser im Ergebnis
    stage.draw();
    const sx = stage.scaleX();
    const teil = ebene.toCanvas({
      x: stage.x(),
      y: stage.y(),
      width: cw * sx,
      height: ch * sx,
      pixelRatio: faktor / sx,
    });
    auswahl.forEach((id, i) => st.selectNode(id, i > 0));
    const c = document.createElement("canvas");
    c.width = Math.round(cw * faktor);
    c.height = Math.round(ch * faktor);
    const g = c.getContext("2d")!;
    const farbe = st.fillColor;
    if (hintergrund || (farbe && farbe !== "transparent")) {
      g.fillStyle = farbe && farbe !== "transparent" ? farbe : "#ffffff";
      g.fillRect(0, 0, c.width, c.height);
    }
    g.drawImage(teil, 0, 0, c.width, c.height);
    return c;
  }, []);

  const speichern = useCallback(async () => {
    if (!daten) return;
    setSpeichert(true);
    try {
      const szene = await useSceneStore.getState().serializeSceneToString();
      const l = await api.leinwandSpeichern({ id: daten.id, name: name.trim() || "Leinwand", breite: daten.breite, hoehe: daten.hoehe, szene });
      setDaten({ ...daten, ...l, szene });
      setGeaendert(false);
      const c = zeichnung(Math.min(1, 640 / Math.max(daten.breite, daten.hoehe)), true);
      if (c) {
        const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.85));
        if (blob) await api.leinwandVorschau(daten.id, blob);
      }
      melde("Gespeichert");
    } catch (e) {
      melde("Nicht gespeichert: " + (e as Error).message, "fehler");
    } finally {
      setSpeichert(false);
    }
  }, [daten, name, zeichnung]);

  const exportiere = (typ: "image/png" | "image/jpeg", faktor: number) => {
    setExportieren(false);
    const c = zeichnung(faktor, typ === "image/jpeg");
    if (!c) return;
    c.toBlob(
      (b) => {
        if (!b) return melde("Export fehlgeschlagen", "fehler");
        const a = document.createElement("a");
        a.href = URL.createObjectURL(b);
        a.download = `${name || "leinwand"}.${typ === "image/png" ? "png" : "jpg"}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      },
      typ,
      0.92,
    );
  };

  // ---------- Tasten (ArtCraft-Belegung, s. shims/keybinds.ts) ----------

  usePagedrawKeybinds(
    useMemo(
      () => ({
        undo: () => useSceneStore.getState().undo(),
        redo: () => useSceneStore.getState().redo(),
        onCopy: () => useSceneStore.getState().copySelectedItems(),
        onPaste: () => useSceneStore.getState().pasteItems(),
        onDelete: () => useSceneStore.getState().deleteSelectedItems(),
        onSelectTool: () => useSceneStore.getState().setActiveTool("select"),
        onShapeTool: () => {
          const st = useSceneStore.getState();
          const reihe = ["rectangle", "circle", "triangle"] as const;
          const naechste = st.activeTool === "shape" && st.currentShape ? reihe[(reihe.indexOf(st.currentShape) + 1) % 3] : st.currentShape ?? "rectangle";
          st.setCurrentShape(naechste);
          st.setActiveTool("shape");
        },
        onBrushTool: () => useSceneStore.getState().setActiveTool("draw"),
        onMaskTool: () => {},
        onEraserTool: () => useSceneStore.getState().setActiveTool("eraser"),
        onBrushSizeUp: () => {
          const st = useSceneStore.getState();
          if (st.activeTool === "eraser") st.setEraserSize(Math.min(128, st.eraserSize + 2));
          else st.setBrushSize(Math.min(128, st.brushSize + 2));
        },
        onBrushSizeDown: () => {
          const st = useSceneStore.getState();
          if (st.activeTool === "eraser") st.setEraserSize(Math.max(1, st.eraserSize - 2));
          else st.setBrushSize(Math.max(1, st.brushSize - 2));
        },
      }),
      [],
    ),
  );

  useEffect(() => {
    const taste = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void speichern();
      }
    };
    window.addEventListener("keydown", taste);
    return () => window.removeEventListener("keydown", taste);
  }, [speichern]);

  // Zwischenablage: eingefuegte Bilder landen auf der Leinwand
  useEffect(() => {
    const einfuegen = (e: ClipboardEvent) => {
      const dateien = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (dateien.length) {
        e.preventDefault();
        ausDateien(dateien);
      }
    };
    window.addEventListener("paste", einfuegen);
    return () => window.removeEventListener("paste", einfuegen);
  }, [ausDateien]);

  const menueAktion = useCallback(
    (aktion: string) => {
      const st = useSceneStore.getState();
      const ids = st.selectedNodeIds;
      switch (aktion) {
        case "LOCK":
          return st.toggleLock(ids);
        case "REMOVE_BACKGROUND":
          return void stelleFrei();
        case "BRING_TO_FRONT":
          return st.bringToFront(ids);
        case "BRING_FORWARD":
          return st.bringForward(ids);
        case "SEND_BACKWARD":
          return st.sendBackward(ids);
        case "SEND_TO_BACK":
          return st.sendToBack(ids);
        case "DUPLICATE":
          st.copySelectedItems();
          return st.pasteItems();
        case "DELETE":
          return st.deleteSelectedItems();
      }
    },
    [stelleFrei],
  );

  const gesperrt = selectedNodeIds.some((nid) => (drawNodes.find((n) => n.id === nid) as Node | undefined)?.locked);
  const bildGewaehlt = drawNodes.some((n) => selectedNodeIds.includes(n.id) && n.type === "image");

  if (fehler)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-text-2">
        <p>{fehler}</p>
        <a href="#/leinwand">
          <Knopf art="rahmen">Zur Übersicht</Knopf>
        </a>
      </div>
    );

  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        ausDateien(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="z-20 flex h-11 shrink-0 items-center gap-2 border-b border-linie bg-grund px-3">
        <a href="#/leinwand">
          <SymbolKnopf title="Zur Übersicht" aria-label="Zur Übersicht">
            <ArrowLeft size={16} />
          </SymbolKnopf>
        </a>
        <input
          className="h-8 w-56 rounded-md border border-transparent bg-transparent px-2 text-[13px] text-text outline-none hover:border-linie focus:border-licht/60"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setGeaendert(true);
          }}
          onKeyDown={(e) => e.stopPropagation()}
          aria-label="Name der Leinwand"
        />
        {daten && (
          <span className="zahl hidden text-[12px] text-text-3 sm:inline">
            {daten.breite} × {daten.hoehe}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Knopf onClick={() => setWahl(true)}>
            <ImagePlus size={14} /> Aus Bibliothek
          </Knopf>
          {freistellenDa && (
            <Knopf onClick={stelleFrei} disabled={!bildGewaehlt || freistellen} title="Hintergrund des gewählten Bildes entfernen">
              <Scissors size={14} /> {freistellen ? "Stelle frei …" : "Freistellen"}
            </Knopf>
          )}
          <SymbolKnopf title="Einpassen" aria-label="Einpassen" onClick={einpassen}>
            <Maximize size={15} />
          </SymbolKnopf>
          <div className="mx-1 h-5 w-px bg-linie" />
          <Knopf art="rahmen" onClick={speichern} disabled={speichert}>
            <Save size={14} /> {speichert ? "Speichert …" : geaendert ? "Speichern •" : "Speichern"}
          </Knopf>
          <Knopf art="licht" onClick={() => setExportieren(true)}>
            <Download size={14} /> Exportieren
          </Knopf>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <SideToolbar
          className="absolute left-0 top-1/2 z-10 -translate-y-1/2"
          onSelect={() => s.setActiveTool("select")}
          onActivateShapeTool={(form) => {
            s.selectNode(null);
            s.setCurrentShape(form);
            s.setActiveTool("shape");
          }}
          onPaintBrush={(hex, groesse, deckkraft) => {
            s.setActiveTool("draw");
            s.setBrushColor(hex);
            s.setBrushSize(groesse);
            s.setBrushOpacity(deckkraft);
          }}
          onCanvasBackground={(hex) => s.setFillColor(hex)}
          onUploadImage={dateiWaehlen}
          activeToolId={activeTool}
          currentShape={currentShape}
          supportsMaskTool={false}
        />
        <div className="absolute inset-0 z-0">
        <ContextMenuContainer
          onAction={(_, aktion) => (aktion === "contextMenu" ? useSceneStore.getState().selectedNodeIds.length > 0 : false)}
          onMenuAction={menueAktion}
          isLocked={gesperrt}
        >
          <PaintSurface
            drawNodes={drawNodes}
            inpaintLineNodes={inpaintLineNodes}
            selectedNodeIds={selectedNodeIds}
            fillColor={fillColor}
            activeTool={activeTool}
            brushColor={brushColor}
            brushSize={brushSize}
            eraserSize={eraserSize}
            inpaintOperation={inpaintOperation}
            inpaintBrushSize={inpaintBrushSize}
            stageRef={stageRef as React.RefObject<Konva.Stage>}
            transformerRefs={transformerRefs}
            baseImageRef={baseImageRef as React.RefObject<Konva.Image>}
            showMaskLayer={false}
            fillParentHeight
          />
        </ContextMenuContainer>
        </div>
        {!daten && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Laedt />
          </div>
        )}
      </div>

      {wahl && <BildWahl onWahl={ausBibliothek} onSchliessen={() => setWahl(false)} />}
      {exportieren && <ExportDialog name={name} onExport={exportiere} onSchliessen={() => setExportieren(false)} />}
    </div>
  );
}
