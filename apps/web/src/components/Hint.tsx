import { useEffect, useRef, type ReactNode } from "react";
import { tipFor, type TipGroup } from "../lib/tips";

/** Icono «!» con una breve explicación (la burbuja la dibuja <TipHost/>). */
export function Hint({ tip }: { tip: string }) {
  return <span className="qhint" tabIndex={0} role="note" data-tip={tip} aria-label={tip}>!</span>;
}

/** Etiqueta con su icono de ayuda cuando existe un texto para ella. */
export function Tip({ group, children, label }: { group: TipGroup; children: ReactNode; label?: string }) {
  const text = label ?? (typeof children === "string" ? children : "");
  const t = text ? tipFor(group, text) : undefined;
  return <>{children}{t && <> <Hint tip={t} /></>}</>;
}

/** Globo flotante único (no lo recorta ninguna tabla con scroll y queda sobre las ventanas modales). */
export function TipHost() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tip = ref.current!;
    const show = (h: HTMLElement) => {
      tip.textContent = h.dataset.tip || "";
      tip.hidden = false;
      if (typeof tip.showPopover === "function") { if (tip.matches(":popover-open")) tip.hidePopover(); tip.showPopover(); }
      const r = h.getBoundingClientRect(), w = tip.offsetWidth;
      tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + "px";
      tip.style.top = r.bottom + 8 + "px";
    };
    const hide = () => { if (typeof tip.hidePopover === "function" && tip.matches(":popover-open")) tip.hidePopover(); tip.hidden = true; };
    const at = (e: Event) => (e.target as Element | null)?.closest?.(".qhint") as HTMLElement | null;
    const over = (e: Event) => { const h = at(e); if (h) show(h); };
    const out = (e: Event) => { if (at(e)) hide(); };
    const click = (e: Event) => { const h = at(e); if (h) { e.preventDefault(); show(h); } else hide(); };
    document.addEventListener("mouseover", over);
    document.addEventListener("mouseout", out);
    document.addEventListener("focusin", over);
    document.addEventListener("focusout", hide);
    document.addEventListener("click", click);
    window.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("mouseover", over);
      document.removeEventListener("mouseout", out);
      document.removeEventListener("focusin", over);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("click", click);
      window.removeEventListener("scroll", hide, true);
    };
  }, []);
  return <div ref={ref} className="tipbox" hidden role="tooltip" {...({ popover: "manual" } as object)} />;
}
