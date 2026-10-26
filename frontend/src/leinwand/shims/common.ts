// Ersatz fuer @storyteller/common: PaintSurface braucht nur das Schachbrett,
// das hinter transparenten Flaechen liegt.
function schachbrett(): string {
  const c = document.createElement("canvas");
  c.width = c.height = 16;
  const g = c.getContext("2d")!;
  g.fillStyle = "#3a3a3a";
  g.fillRect(0, 0, 16, 16);
  g.fillStyle = "#2c2c2c";
  g.fillRect(0, 0, 8, 8);
  g.fillRect(8, 8, 8, 8);
  return c.toDataURL("image/png");
}

export const checkerboard: string = typeof document === "undefined" ? "" : schachbrett();
