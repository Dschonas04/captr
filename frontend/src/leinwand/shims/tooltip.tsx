// Ersatz fuer @storyteller/ui-tooltip: ein schlichter Hinweis neben dem Knopf.
import { useRef, useState, type ReactNode } from "react";

export function Tooltip({
  content,
  children,
  position = "top",
  className = "",
  delay = 200,
  closeOnClick = false,
}: {
  content: ReactNode;
  children: ReactNode;
  position?: "top" | "right" | "bottom" | "left";
  className?: string;
  delay?: number;
  closeOnClick?: boolean;
}) {
  const [offen, setOffen] = useState(false);
  const uhr = useRef<number | undefined>(undefined);
  const lage = {
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
  }[position];
  return (
    <div
      className="relative"
      onMouseEnter={() => {
        window.clearTimeout(uhr.current);
        uhr.current = window.setTimeout(() => setOffen(true), delay);
      }}
      onMouseLeave={() => {
        window.clearTimeout(uhr.current);
        setOffen(false);
      }}
      onClick={() => closeOnClick && setOffen(false)}
    >
      {children}
      {offen && (
        <div
          role="tooltip"
          className={`pointer-events-none absolute z-50 whitespace-nowrap bg-ui-panel text-xs text-base-fg shadow-lg ring-1 ring-white/10 ${lage} ${className}`}
        >
          {content}
        </div>
      )}
    </div>
  );
}
