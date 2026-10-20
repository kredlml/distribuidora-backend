import { useEffect, useMemo, useState } from "react";
import { ChipBar } from "../../components/Chip";
import { Cargando, ErrorCard } from "../../components/Estado";
import SearchBox from "../../components/SearchBox";
import { useAuth } from "../../context/AuthContext";
import useFetch from "../../hooks/useFetch";
import * as inventarioService from "../../services/inventarioService";
import * as productosService from "../../services/productosService";
import { INV_ESTADOS, INV_TONO } from "../../utils/constants";
import { humanizar, prod } from "../../utils/format";
import { puede } from "../../utils/permisos";
import AjusteDialog from "./AjusteDialog";

/** Stock de una sucursal por fila de inventario (lote y estado), con baja de una o varias filas. */
export default function StockSucursal({ sucursal }) {
  const { rol } = useAuth();
  const ajusta = puede(rol, "ajustarStock");
  const [f, setF] = useState({ q: "", estado: "", agotadas: false });
  const [sel, setSel] = useState(() => new Set());
  const [ajustando, setAjustando] = useState(false);
  const { data, error, loading, reload } = useFetch(async () => {
    const [inv, prods] = await Promise.all([inventarioService.deSucursal(sucursal.id_sucursal), productosService.listar()]);
    return { inv, P: Object.fromEntries(prods.map((p) => [p.id_producto, p])) };
  }, [sucursal.id_sucursal]);

  const filas = useMemo(() => {
    if (!data) return [];
    return data.inv
      .map((i) => ({ ...i, prenda: data.P[i.id_producto] }))
      .sort((a, b) => prod(a.prenda).localeCompare(prod(b.prenda)) || a.id_inventario - b.id_inventario);
  }, [data]);

  // Tras recargar se quitan de la selección las filas que ya no existen o quedaron en 0 (p.ej. por
  // una venta mientras se editaba): no se pueden dar de baja y bloquearían el diálogo.
  useEffect(() => {
    setSel((s) => {
      const vivas = new Set(filas.filter((x) => x.cantidad > 0).map((x) => x.id_inventario));
      const n = new Set([...s].filter((id) => vivas.has(id)));
      return n.size === s.size ? s : n;
    });
  }, [filas]);

  if (loading && !data) return <Cargando>Cargando el stock de {sucursal.nombre}…</Cargando>;
  if (error) return <ErrorCard message={error} onRetry={reload} />;

  const estados = [...new Set([...INV_ESTADOS, ...filas.map((x) => x.estado)])];
  const q = f.q.trim().toLowerCase();
  const visibles = filas.filter((x) => (f.agotadas || x.cantidad > 0) && (!f.estado || x.estado === f.estado) &&
    (!q || `${x.id_producto} ${prod(x.prenda)} ${x.lote || ""}`.toLowerCase().includes(q)));
  const elegibles = visibles.filter((x) => x.cantidad > 0);
  const total = (e) => filas.filter((x) => x.estado === e).reduce((s, x) => s + x.cantidad, 0);
  const todas = elegibles.length > 0 && elegibles.every((x) => sel.has(x.id_inventario));
  const seleccionadas = filas.filter((x) => sel.has(x.id_inventario) && x.cantidad > 0);

  const alternar = (id, on) => setSel((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const alternarTodas = (on) => setSel((s) => { const n = new Set(s); elegibles.forEach((x) => (on ? n.add(x.id_inventario) : n.delete(x.id_inventario))); return n; });
  const terminarAjuste = (ok) => { setAjustando(false); if (ok) setSel(new Set()); reload(); };

  return (
    <section className="card">
      <div className="head stock-head">
        <div><h2>Stock de {sucursal.nombre}</h2><div className="muted sm">{filas.length} fila{filas.length === 1 ? "" : "s"} de inventario (cada ingreso o lote es una fila).</div></div>
        {ajusta && <button className="btn bad" disabled={!seleccionadas.length} onClick={() => setAjustando(true)}>Dar de baja o ajustar ({seleccionadas.length})</button>}
      </div>
      <div className="bar">
        {estados.map((e) => <span key={e} className={`st ${INV_TONO[e] || ""}`}>{humanizar(e)}: {total(e)}</span>)}
      </div>
      <div className="bar">
        <SearchBox label="Buscar" placeholder="Buscar prenda, número o lote" value={f.q} onChange={(ev) => setF({ ...f, q: ev.target.value })} />
      </div>
      <ChipBar items={["", ...estados].map((e) => [e, e ? humanizar(e) : "Todos los estados"])} value={f.estado} onChange={(estado) => setF({ ...f, estado })} />
      <label className="chk sm agotadas"><input type="checkbox" checked={f.agotadas} onChange={(e) => setF({ ...f, agotadas: e.target.checked })} /><span>Mostrar filas en 0</span></label>

      <div className="tabla-scroll">
        <div className="fila-stock cab muted sm">
          <span>{ajusta && <input type="checkbox" aria-label="Seleccionar todas las filas visibles" checked={todas} disabled={!elegibles.length} onChange={(e) => alternarTodas(e.target.checked)} />}</span>
          <span>Prenda</span><span>Lote</span><span>Estado</span><span className="num">Cantidad</span>
        </div>
        {visibles.length ? visibles.map((x) => (
          <label className={`fila-stock ${x.cantidad === 0 ? "cero" : ""}`} key={x.id_inventario}>
            <span>{ajusta && <input type="checkbox" checked={sel.has(x.id_inventario)} disabled={x.cantidad === 0} onChange={(e) => alternar(x.id_inventario, e.target.checked)} />}</span>
            <span>{prod(x.prenda)}<br /><span className="muted sm">Prenda #{x.id_producto}, fila #{x.id_inventario}</span></span>
            <span className="sm">{x.lote || <span className="muted">Sin lote</span>}</span>
            <span><span className={`st ${INV_TONO[x.estado] || ""}`}>{humanizar(x.estado)}</span></span>
            <span className="num">{x.cantidad}</span>
          </label>
        )) : <p className="muted">No hay stock con estos filtros.</p>}
      </div>

      {ajustando && <AjusteDialog sucursal={sucursal} filas={seleccionadas} onClose={() => terminarAjuste(false)} onDone={() => terminarAjuste(true)} />}
    </section>
  );
}
