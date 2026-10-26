// Ersatz fuer @storyteller/icons: DynamicIcon zeichnet eine Lucide-Komponente.
import type { ComponentType } from "react";

export function DynamicIcon({ icon: Icon, className }: { icon: ComponentType<{ className?: string }>; className?: string }) {
  return <Icon className={className} />;
}
