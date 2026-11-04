import { useState } from "react";
import { defaultTemplates, HH_DAY, tplDays, uid, type TemplateAct } from "@qa/core";
import { Grow } from "../components/forms";
import { Tip } from "../components/Hint";
import { useApp } from "../state/app";
import { ask, askText, say } from "../state/ui";

type Path = { k: "trad" | "express" } | { c: number };

/** Tabla editable de actividades base de una plantilla. */
function TplTable({ id, acts, path }: { id: string; acts: TemplateAct[]; path: Path }) {
  const { mutate, readOnly } = useApp();
  const edit = (fn: (a: TemplateAct[]) => void) => mutate(s => fn("k" in path ? s.templates[path.k] : s.customTpl[path.c].acts));
  return (
    <table id={id}>
      <thead><tr>
        <th>#</th><th><Tip group="act">Actividad</Tip></th>
        <th><Tip group="act">Duración</Tip>{" "}
          <select aria-label="Poner todas las actividades en la misma unidad" disabled={readOnly} value="" onChange={e => { const u = e.target.value as "d" | "hh"; if (!u) return; edit(a => a.forEach(x => (x.unit = u))); say(u === "hh" ? "Todas las actividades quedaron en HH." : "Todas las actividades quedaron en días."); }}>
            <option value="">Unidad de todas…</option><option value="d">Todas en días</option><option value="hh">Todas en HH</option>
          </select>
        </th><th />
      </tr></thead>
      <tbody>
        {acts.map((x, i) => (
          <tr key={i}>
            <td>{i + 1}</td>
            <td><Grow maxLength={500} disabled={readOnly} value={x.name} onChange={v => edit(a => (a[i].name = v))} /></td>
            <td>
              <div className="durw">
                <input type="number" min={1} disabled={readOnly} aria-label="Duración" value={x.days} onChange={e => edit(a => (a[i].days = Math.max(1, +e.target.value)))} />
                <select aria-label="Unidad de la duración" disabled={readOnly} value={x.unit === "hh" ? "hh" : "d"} onChange={e => edit(a => (a[i].unit = e.target.value as "d" | "hh"))}><option value="d">Días</option><option value="hh">HH</option></select>
              </div>
              {x.unit === "hh" && <small className="muted">≈ {tplDays(x)} día(s) · {HH_DAY} HH = 1 día</small>}
            </td>
            <td>{!readOnly && <><button type="button" onClick={() => i && edit(a => { [a[i - 1], a[i]] = [a[i], a[i - 1]]; })}>↑</button> <button type="button" className="danger" onClick={() => edit(a => a.splice(i, 1))}>✕</button></>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Templates() {
  const { store, mutate, readOnly } = useApp();
  const [, force] = useState(0);
  const addAct = (path: Path) => mutate(s => (("k" in path ? s.templates[path.k] : s.customTpl[path.c].acts)).push({ name: "Nueva actividad", days: 1, unit: "d" }));
  const newType = async () => {
    const name = ((await askText("Nombre del nuevo tipo de requerimiento (ej: QA Performance, Regresión):", "", { title: "Nuevo tipo" })) || "").trim();
    if (!name) return;
    if (store.customTpl.some(c => c.name.toLowerCase() === name.toLowerCase())) return say("Ya existe un tipo con ese nombre.", true);
    mutate(s => { s.customTpl.push({ id: uid(), name, acts: [{ name: "Nueva actividad", days: 1, unit: "d" }] }); });
    say("Tipo creado ✓ (ya está disponible en el campo Tipo)");
  };
  const base = (k: "trad" | "express", title: string, desc: string) => (
    <div className="card">
      <h2><Tip group="head">{title}</Tip></h2>
      <p className="muted">{desc}</p>
      <TplTable id={"tplTbl-" + k} acts={store.templates[k]} path={{ k }} />
      {!readOnly && <><button className="tplAdd" onClick={() => addAct({ k })}>+ Actividad</button> <button className="tplReset" onClick={async () => { if (await ask("¿Restaurar esta plantilla por defecto?")) mutate(s => { s.templates[k] = defaultTemplates()[k]; }); }}>Restaurar por defecto</button></>}
    </div>
  );
  return (
    <section id="v-tpl" className="view" key={force.toString()}>
      <div className="toolbar">
        {!readOnly && <button type="button" id="btnTplNew" className="primary" onClick={() => void newType()}>+ Nuevo tipo</button>}
        <span className="muted">Cada tipo es una plantilla de actividades: se elige en el campo "Tipo" del requerimiento. Crea los tuyos además de Tradicional y Express.</span>
      </div>
      {base("trad", "Actividades base de QA Tradicional", "Se copian a cada requerimiento tradicional nuevo (carta Gantt completa), y allí puedes ajustarlas. Cambiar esto no altera requerimientos ya creados.")}
      {base("express", "Actividades base de QA Express", "Pruebas rápidas: diseño de casos, ejecución, certificación e informe final. Se copian a cada requerimiento express nuevo.")}
      <div id="tplCustom">
        {store.customTpl.map((c, n) => (
          <div className="card" key={c.id}>
            <h2><input className="tplName" aria-label="Nombre de la plantilla" disabled={readOnly} defaultValue={c.name} onBlur={e => { const v = e.target.value.trim(); if (!v) { e.target.value = c.name; return; } if (v !== c.name) mutate(s => { s.customTpl[n].name = v; }); force(x => x + 1); }} /></h2>
            <p className="muted">Tipo personalizado: aparece en el campo "Tipo" de los requerimientos y copia estas actividades.</p>
            <TplTable id={"tplTblC-" + n} acts={c.acts} path={{ c: n }} />
            {!readOnly && <>
              <button className="tplCAdd" onClick={() => addAct({ c: n })}>+ Actividad</button>{" "}
              <button className="tplCDel danger" onClick={async () => {
                const used = store.reqs.filter(r => r.type === c.id).length;
                if (used) return say(`No se puede eliminar "${c.name}": lo usan ${used} requerimiento(s). Cámbiales el tipo primero.`, true);
                if (await ask(`¿Eliminar el tipo "${c.name}"?`)) mutate(s => { s.customTpl.splice(n, 1); });
              }}>Eliminar tipo</button>
            </>}
          </div>
        ))}
      </div>
    </section>
  );
}
