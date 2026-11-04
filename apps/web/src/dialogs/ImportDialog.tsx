import { useState } from "react";
import { buildImported, IMPORT_TEMPLATE_CSV, parseSheet, type ImportRow } from "@qa/core";
import { Modal } from "../components/Modal";
import { download } from "../lib/files";
import { authorName, useApp, useCalc } from "../state/app";
import { useDialogs } from "../state/dialogs";
import { say } from "../state/ui";

/** Lee la primera hoja de un .xlsx/.xls/.csv como filas de objetos (la librería se carga solo al usarla). */
async function readSheet(f: File): Promise<Record<string, unknown>[]> {
  const XLSX = await import("xlsx");
  let wb;
  if (/\.csv$/i.test(f.name)) { // CSV: UTF-8 o Windows-1252, separado por coma o punto y coma
    const buf = await f.arrayBuffer();
    let txt = new TextDecoder("utf-8").decode(buf);
    if (txt.includes("�")) txt = new TextDecoder("windows-1252").decode(buf);
    txt = txt.replace(/^﻿/, "");
    const l1 = txt.split(/\r?\n/)[0] || "";
    wb = XLSX.read(txt, { type: "string", raw: true, FS: (l1.match(/;/g) || []).length > (l1.match(/,/g) || []).length ? ";" : "," });
  } else wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: true });
}

export function ImportDialog() {
  const open = useDialogs(s => s.importing), setOpen = useDialogs(s => s.setImporting);
  const { store, clientId, commit } = useApp();
  const calc = useCalc();
  const [rows, setRows] = useState<ImportRow[]>([]), [msg, setMsg] = useState("");
  const close = () => { setOpen(false); setRows([]); setMsg(""); };
  const n = rows.filter(r => r.ok).length;
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setMsg(""); setRows([]);
    try { setRows(parseSheet(await readSheet(f), store, clientId, calc.today)); }
    catch (er) { setMsg((er as Error).message || "No se pudo leer el archivo."); }
  };
  const doImport = () => {
    const { reqs, clients } = buildImported(rows, store, calc.today, authorName());
    if (!reqs.length) return;
    commit(s => { clients.forEach(c => { if (!s.clients.some(x => x.id === c.id)) s.clients.push(c); }); reqs.forEach(r => { if (!s.reqs.some(x => x.id === r.id)) s.reqs.push(r); }); });
    close(); say(`${reqs.length} requerimiento(s) importado(s) ✓`);
  };
  return (
    <Modal open={open} id="imdlg" className="imdlg" onCancel={close}>
      <header><h2>Importar requerimientos desde Excel / CSV</h2><button type="button" id="imClose" onClick={close} aria-label="Cerrar">✕</button></header>
      <div className="pbody">
        <p className="muted">Sube una planilla con una fila por requerimiento. Columnas reconocidas: <b>Código, Título, Cliente, Tipo</b> (Express/Tradicional)<b>, Responsable, Inicio, Fin, Estado, Avance</b>. Las actividades se crean con la plantilla del tipo, ajustadas entre Inicio y Fin.{" "}
          <a href="#" onClick={e => { e.preventDefault(); download(new Blob(["﻿" + IMPORT_TEMPLATE_CSV], { type: "text/csv" }), "plantilla-importacion-requerimientos.csv"); }}>Descargar plantilla CSV</a></p>
        <input type="file" id="imFile" accept=".xlsx,.xls,.csv" onChange={e => void onFile(e)} />
        {msg && <div className="loginErr">{msg}</div>}
        {rows.length > 0 && (
          <div className="tablewrap">
            <table id="imTbl">
              <thead><tr><th /><th>Estado</th><th>Código</th><th>Título</th><th>Cliente</th><th>Tipo</th><th>Responsable</th><th>Inicio</th><th>Fin</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td><input type="checkbox" checked={r.ok} disabled={!!r.err} onChange={e => setRows(l => l.map((x, k) => (k === i ? { ...x, ok: e.target.checked } : x)))} /></td>
                    <td>{r.err ? <span className="st al3">{r.err}</span> : <><span className="st st-Completado">OK</span>{r.notes.length > 0 && <> <small className="muted">{r.notes.join(", ")}</small></>}</>}</td>
                    <td><b>{r.code}</b></td><td>{r.title}</td><td>{r.clientName}{r.clientNew && <> <span className="badge">nuevo</span></>}</td><td>{r.type === "express" ? "Express" : "Tradicional"}</td><td>{r.assigneeName || "—"}</td><td>{r.start}</td><td>{r.end || <span className="muted">según plantilla</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <footer>
        <span className="muted">{rows.length ? `${n} de ${rows.length} filas se importarán` : ""}</span><div className="spacer" />
        <button type="button" onClick={close}>Cancelar</button>
        <button type="button" className="primary" disabled={!n} onClick={doImport}>{n ? `Importar ${n}` : "Importar"}</button>
      </footer>
    </Modal>
  );
}
