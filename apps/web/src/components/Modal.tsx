import { useEffect, useRef, type FormEvent, type ReactNode } from "react";

/**
 * Ventana modal nativa (<dialog>). Esc ejecuta `onCancel` (que decide si cierra, p. ej. preguntando por cambios sin guardar).
 * Los hijos solo existen mientras está abierta, así cada apertura parte con el estado limpio.
 */
export function Modal({ open, onCancel, className, children, id, onSubmit, formClass = "rform", formId }: {
  open: boolean; onCancel: () => void; className?: string; children?: ReactNode; id?: string; onSubmit?: (e: FormEvent<HTMLFormElement>) => void; formClass?: string; formId?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => {
    const d = ref.current!;
    const cancel = (e: Event) => { e.preventDefault(); onCancel(); };
    d.addEventListener("cancel", cancel);
    return () => d.removeEventListener("cancel", cancel);
  }, [onCancel]);
  return (
    <dialog ref={ref} id={id} className={className}>
      {open && (
        <form method="dialog" id={formId} className={formClass} onSubmit={onSubmit ?? (e => e.preventDefault())} noValidate>
          {children}
        </form>
      )}
    </dialog>
  );
}
