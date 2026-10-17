import { useMemo, useState } from "react";
import { ChipBar } from "../../components/Chip";
import { Cargando, ErrorCard } from "../../components/Estado";
import SearchBox from "../../components/SearchBox";
import Select from "../../components/Select";
import useFetch from "../../hooks/useFetch";
import * as inventarioService from "../../services/inventarioService";
import * as productosService from "../../services/productosService";
import * as sucursalesService from "../../services/sucursalesService";
import { INV_ESTADOS, INV_TONO } from "../../utils/constants";
import { humanizar, prod } from "../../utils/format";
import "./Inventario.css";

export default function Inventario() {
  const [f, setF] = useState({ estado: "", suc: "", q: "" });
  const { data, error, loading, reload } = useFetch(async () => {
    const [inv, prods, sucs] = await Promise.all([inventarioService.listar(), productosService.listar(), sucursalesService.listar()]);
    return { inv, prods, sucs };
  }, []);

  const m = useMemo(() => {
    if (!data) return null;
    const { inv, prods, sucs } = data;
    const P = Object.fromEntries(prods.map((p) => [p.id_producto, p]));
    const S = Object.fromEntries(sucs.map((x) => [x.id_sucursal, x.nombre]));
    const estados = [...new Set([...INV_ESTADOS, ...inv.map((i) => i.estado)])];
    const grupos = {};
    inv.forEach((i) => {
      const g = (grupos[i.id_producto + "|" + i.id_sucursal] ||= { id_producto: i.id_producto, id_sucursal: i.id_sucursal, est: {} });
      g.est[i.estado] = (g.est[i.estado] || 0) + i.cantidad;
    });
    return { P, S, estados, grupos: Object.values(grupos), sucursales: [...new Set(inv.map((i) => i.id_sucursal))] };
  }, [data]);

  if (loading && !data) return <><Cabecera /><Cargando>Cargando inventario…</Cargando></>;
  if (error) return <><Cabecera /><ErrorCard message={error} onRetry={reload} /></>;

  const { P, S, estados, grupos, sucursales } = m;
  const nombreSuc = (id) => S[id] || `Sucursal ${id}`;
  const q = f.q.trim().toLowerCase();
  let gs = grupos.filter((g) => (!f.suc || String(g.id_sucursal) === f.suc) && (!q || `${g.id_producto} ${prod(P[g.id_producto])}`.toLowerCase().includes(q)));
  const tot = {};
  gs.forEach((g) => estados.forEach((e) => (tot[e] = (tot[e] || 0) + (g.est[e] || 0))));
  if (f.estado) gs = gs.filter((g) => g.est[f.estado] > 0);
  gs = [...gs].sort((a, b) => a.id_producto - b.id_producto || a.id_sucursal - b.id_sucursal);

  return (
    <>
      <Cabecera cuenta={`${gs.length} combinación${gs.length === 1 ? "" : "es"} de producto y sucursal`} />
      <div className="bar">
        {estados.map((e) => <span key={e} className={`st ${INV_TONO[e] || ""}`}>{humanizar(e)}: {tot[e] || 0}</span>)}
      </div>
      <div className="bar">
        <SearchBox label="Buscar" placeholder="Buscar producto por nombre, talla, color o número" value={f.q} onChange={(ev) => setF({ ...f, q: ev.target.value })} />
      </div>
      <ChipBar items={["", ...estados].map((e) => [e, e ? humanizar(e) : "Todos"])} value={f.estado} onChange={(estado) => setF({ ...f, estado })} />
      <div className="bar">
        <Select className="pill" aria-label="Sucursal" value={f.suc} placeholder="Todas las sucursales"
          onChange={(ev) => setF({ ...f, suc: ev.target.value })} options={sucursales.map((id) => [id, nombreSuc(id)])} />
      </div>
      <div className="stack">
        {gs.length ? gs.map((g) => (
          <div className="card inv" key={g.id_producto + "|" + g.id_sucursal}>
            <span>{prod(P[g.id_producto])}<br /><span className="muted sm">Producto #{g.id_producto}</span></span>
            <span>{nombreSuc(g.id_sucursal)}</span>
            <span className="qtys">
              {estados.map((e) => <span key={e} className={`st ${INV_TONO[e] || ""} ${g.est[e] ? "" : "zero"}`}>{humanizar(e)} {g.est[e] || 0}</span>)}
            </span>
          </div>
        )) : <Cargando>No hay existencias con estos filtros.</Cargando>}
      </div>
    </>
  );
}

function Cabecera({ cuenta = " " }) {
  return <div className="head"><div><h1>Inventario por estado</h1><div className="muted sm">{cuenta}</div></div></div>;
}
