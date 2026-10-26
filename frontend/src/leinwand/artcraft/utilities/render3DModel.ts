// Captr: Aus ArtCraft (render3DModel.ts) bleibt nur der Typ, den Node.ts
// mitschleppt. Captr legt keine 3D-Modelle auf die Leinwand; three.js fehlt
// darum bewusst.
export interface Model3DParams {
  cameraPosition: { x: number; y: number; z: number };
  cameraTarget: { x: number; y: number; z: number };
  fov: number;
  modelScale: number;
  nativeWidth: number;
  nativeHeight: number;
}
