// Avisos flotantes y ventanas de confirmación (reemplazan alert/confirm/prompt del navegador), con API de promesas.
import { create } from "zustand";
import type { Requirement } from "@qa/core";

export interface ToastItem { id: number; msg: string; err: boolean; anchor: DOMRect | null; el: Element | null }

export interface AskOpts { title?: string; ok?: string; cancel?: string; danger?: boolean; placeholder?: string; optional?: boolean }
type Modal =
  | { kind: "ask"; msg: string; opts: AskOpts; resolve: (v: boolean) => void }
  | { kind: "askText"; msg: string; def: string; opts: AskOpts; resolve: (v: string | null) => void }
  | { kind: "reason"; msg: string; resolve: (v: string | null) => void }
  | { kind: "pick"; title: string; ok: string; hint: string; list: Requirement[]; resolve: (v: Requirement[] | null) => void };

interface UiState {
  toasts: ToastItem[];
  modal: Modal | null;
  anchor: { el: Element; rect: DOMRect; at: number } | null;
}
export const useUi = create<UiState>(() => ({ toasts: [], modal: null, anchor: null }));

let seq = 0;

/** Último control que tocó la persona: los avisos salen justo encima de él. */
export function trackAnchor(e: Event) {
  const c = (e.target as Element | null)?.closest?.("button, input, select, textarea, summary, a");
  if (c && !c.closest(".toast")) useUi.setState({ anchor: { el: c, rect: c.getBoundingClientRect(), at: Date.now() } });
}

export function toast(msg: string, err = false) {
  if (!msg) return;
  const a = useUi.getState().anchor;
  const fresh = a && Date.now() - a.at < 30000 ? a : null;
  const item: ToastItem = { id: ++seq, msg, err, anchor: fresh ? (fresh.el.isConnected ? fresh.el.getBoundingClientRect() : fresh.rect) : null, el: fresh?.el ?? null };
  useUi.setState(s => ({ toasts: [...s.toasts, item] }));
  setTimeout(() => dismissToast(item.id), err ? 9000 : 3200);
}
export const dismissToast = (id: number) => useUi.setState(s => ({ toasts: s.toasts.filter(t => t.id !== id) }));
/** Atajo con el mismo nombre que usaba la versión original. */
export const say = toast;

const open = <T,>(m: (resolve: (v: T) => void) => Modal) => new Promise<T>(resolve => useUi.setState({ modal: m(resolve as never) }));
export const closeModal = () => useUi.setState({ modal: null });

export const ask = (msg: string, opts: AskOpts = {}): Promise<boolean> => open<boolean>(resolve => ({ kind: "ask", msg, opts, resolve }));
export const askText = (msg: string, def = "", opts: AskOpts = {}): Promise<string | null> => open<string | null>(resolve => ({ kind: "askText", msg, def, opts, resolve }));
export const askReason = (msg: string): Promise<string | null> => open<string | null>(resolve => ({ kind: "reason", msg, resolve }));
export const pickReqs = (o: { title: string; ok: string; hint?: string; list: Requirement[] }): Promise<Requirement[] | null> =>
  open<Requirement[] | null>(resolve => ({ kind: "pick", title: o.title, ok: o.ok, hint: o.hint || "", list: o.list, resolve }));
