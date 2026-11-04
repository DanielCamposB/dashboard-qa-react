// Estado global de la aplicación (zustand): documento de datos, modo, cliente activo y filtros.
import { create } from "zustand";
import { emptyStore, makeCalc, todayLocal, type Calc, type Op, type Requirement, type Store } from "@qa/core";
import { useMemo } from "react";
import { D } from "../lib/data";
import { lsGet, lsSet } from "../lib/storage";

export interface Filters { type: string; role: string; assignee: string; prio: string; bucket: string; status: string; text: string }
export const NO_FILTERS: Filters = { type: "", role: "", assignee: "", prio: "", bucket: "", status: "", text: "" };

export const VIEWS = ["dash", "hoy", "resumen", "gantt", "team", "leaders", "clients", "avisos", "perm", "tpl"] as const;
export type View = (typeof VIEWS)[number];

interface AppState {
  store: Store;
  user: string; // correo de la sesión ("" en modo local)
  readOnly: boolean;
  clientId: string;
  pxDay: number;
  filters: Filters;
  alertsOpen: boolean;
  init: (store: Store, user: string, forceRead: boolean | null) => void;
  setStore: (s: Store) => void;
  /** Cambio pequeño que se puede volver a aplicar sobre la última versión si otra persona guardó antes. */
  commit: (op: Op) => void;
  /** Cambio normal: se guarda el documento completo. */
  mutate: (fn: (s: Store) => void) => void;
  setReadOnly: (v: boolean) => void;
  setClient: (id: string) => void;
  setPxDay: (n: number) => void;
  setFilter: (k: keyof Filters, v: string) => void;
  clearFilters: () => void;
  setAlertsOpen: (v: boolean) => void;
}

const clone = <T,>(x: T): T => structuredClone(x);

export const useApp = create<AppState>((set, get) => ({
  store: emptyStore(),
  user: "",
  readOnly: false,
  clientId: lsGet("qa-client", "all"),
  pxDay: +lsGet("qa-zoom", "14") || 14,
  filters: NO_FILTERS,
  alertsOpen: false,
  init: (store, user, forceRead) => set({ store, user, readOnly: forceRead ?? lsGet("qa-mode", "edit") === "read" }),
  setStore: s => set({ store: s }),
  commit: op => {
    const next = clone(get().store);
    op(next);
    D.queueOp(op);
    D.save(next);
    set({ store: next });
  },
  mutate: fn => {
    const next = clone(get().store);
    fn(next);
    D.save(next);
    set({ store: next });
  },
  setReadOnly: v => { lsSet("qa-mode", v ? "read" : "edit"); set({ readOnly: v }); },
  setClient: id => { lsSet("qa-client", id); set({ clientId: id }); },
  setPxDay: n => { lsSet("qa-zoom", String(n)); set({ pxDay: n }); },
  setFilter: (k, v) => set(s => ({ filters: { ...s.filters, [k]: v } })),
  clearFilters: () => set({ filters: NO_FILTERS }),
  setAlertsOpen: v => set({ alertsOpen: v }),
}));

/** Administrador: con Supabase, el rol `admin`; en modo local, cualquiera que esté en modo Editor. */
export const useIsAdmin = (): boolean => {
  const ro = useApp(s => s.readOnly);
  return D.remote ? D.isAdmin() : !ro;
};

/** Cálculos del dashboard para el documento actual (se recalculan solo cuando cambian los datos). */
export function useCalc(): Calc {
  const store = useApp(s => s.store);
  const today = todayLocal();
  return useMemo(() => makeCalc(store, today), [store, today]);
}

/** Requerimientos del cliente elegido en el selector de arriba. */
export function useScoped(): Requirement[] {
  const store = useApp(s => s.store);
  const clientId = useApp(s => s.clientId);
  return useMemo(() => (clientId === "all" ? store.reqs : store.reqs.filter(r => r.clientId === clientId)), [store, clientId]);
}

/** Requerimientos que pasan los filtros del Dashboard (también los usa la Carta Gantt y las exportaciones). */
export function useVisible(): Requirement[] {
  const scoped = useScoped();
  const f = useApp(s => s.filters);
  const calc = useCalc();
  return useMemo(() => {
    const q = f.text.toLowerCase();
    return scoped.filter(r =>
      (!f.type || r.type === f.type) && (!f.assignee || calc.ids(r).includes(f.assignee)) && (!f.role || calc.rolesOf(r).includes(f.role)) && (!f.status || r.status === f.status) &&
      (!f.prio || r.priority === f.prio) && (!f.bucket || r.bucket === f.bucket) &&
      (!q || (r.code + " " + r.title + " " + r.comments.map(c => c.text).join(" ")).toLowerCase().includes(q)));
  }, [scoped, f, calc]);
}

export const authorName = (): string => lsGet("qa-author", "") || "Anónimo";
