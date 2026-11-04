// Qué ventanas grandes están abiertas (requerimiento, perfil, importar) y datos pequeños compartidos entre pestañas.
import { create } from "zustand";

interface DialogState {
  req: { id: string | null } | null; // id = null → requerimiento nuevo
  profile: { first: boolean } | null;
  importing: boolean;
  permCount: number; // solicitudes pendientes + cuentas bloqueadas (globo rojo de la pestaña Permisos)
  msAccount: string; // cuenta Microsoft conectada para leer Planner
  profileRev: number; // sube cuando se guarda el perfil, para refrescar el menú de usuario
  bumpProfile: () => void;
  openReq: (id: string | null) => void;
  closeReq: () => void;
  openProfile: (first?: boolean) => void;
  closeProfile: () => void;
  setImporting: (v: boolean) => void;
  setPermCount: (n: number) => void;
  setMsAccount: (a: string) => void;
}

export const useDialogs = create<DialogState>(set => ({
  req: null,
  profile: null,
  importing: false,
  permCount: 0,
  msAccount: "",
  profileRev: 0,
  bumpProfile: () => set(s => ({ profileRev: s.profileRev + 1 })),
  openReq: id => set({ req: { id } }),
  closeReq: () => set({ req: null }),
  openProfile: (first = false) => set({ profile: { first } }),
  closeProfile: () => set({ profile: null }),
  setImporting: v => set({ importing: v }),
  setPermCount: n => set({ permCount: n }),
  setMsAccount: a => set({ msAccount: a }),
}));
