import { useRef } from "react";

export interface PickOption { value: string; label: string; extra?: string }

/** Selector múltiple desplegable (roles, responsables…): lo elegido se ve como etiquetas que se acomodan sin solaparse. */
export function MultiPick({ options, selected, onChange, disabled, empty, placeholder = "Sin asignar", ariaLabel }: {
  options: PickOption[]; selected: string[]; onChange: (v: string[]) => void; disabled?: boolean; empty: string; placeholder?: string; ariaLabel?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const toggle = (v: string, on: boolean) => onChange(on ? [...new Set([...selected, v])] : selected.filter(x => x !== v));
  // el menú se posiciona sobre la ventana (fixed) para que ninguna columna lo recorte ni lo solape
  const place = () => {
    const d = ref.current!, m = d.querySelector<HTMLElement>(".rpmenu")!, r = d.querySelector("summary")!.getBoundingClientRect();
    if (!d.open) return;
    const h = Math.min(m.scrollHeight, 320), below = innerHeight - r.bottom - 12, up = below < h && r.top > below;
    Object.assign(m.style, { position: "fixed", left: r.left + "px", minWidth: r.width + "px", maxHeight: Math.max(120, Math.min(320, up ? r.top - 12 : below)) + "px", overflowY: "auto", top: up ? "" : r.bottom + 4 + "px", bottom: up ? innerHeight - r.top + 4 + "px" : "" });
  };
  const names = selected.map(v => options.find(o => o.value === v)?.label ?? "—");
  return (
    <details className="rolepick" ref={ref} onToggle={place}>
      <summary aria-label={ariaLabel}>{names.length ? names.map(n => <span className="chip" key={n}>{n}</span>) : placeholder}</summary>
      <div className="rpmenu">
        {options.length
          ? options.map(o => (
            <label key={o.value}>
              <input type="checkbox" value={o.value} checked={selected.includes(o.value)} disabled={disabled} onChange={e => toggle(o.value, e.target.checked)} /> {o.label}{o.extra ? " · " + o.extra : ""}
            </label>))
          : <small className="muted">{empty}</small>}
      </div>
    </details>
  );
}

/** Cierra los selectores abiertos al hacer clic fuera o al desplazar la página (se monta una sola vez). */
export function installPickGlobals(): () => void {
  const click = (e: Event) => document.querySelectorAll<HTMLDetailsElement>(".rolepick[open]").forEach(d => { if (!d.contains(e.target as Node)) d.open = false; });
  const scroll = (e: Event) => { if (!(e.target as Element).closest?.(".rpmenu")) document.querySelectorAll<HTMLDetailsElement>(".rolepick[open]").forEach(d => (d.open = false)); };
  document.addEventListener("click", click);
  document.addEventListener("scroll", scroll, true);
  return () => { document.removeEventListener("click", click); document.removeEventListener("scroll", scroll, true); };
}
