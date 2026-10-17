import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChipBar, ChipEstado } from "../../components/Chip";
import { Cargando, ErrorCard } from "../../components/Estado";
import SearchBox from "../../components/SearchBox";
import { useAuth } from "../../context/AuthContext";
import useFetch from "../../hooks/useFetch";
import * as devolucionesService from "../../services/devolucionesService";
import { CHIPS, ESTADOS, TIPOS } from "../../utils/constants";
import { fecha, humanizar, nombreCli } from "../../utils/format";
import { PERMISOS, ROLES } from "../../utils/permisos";
import "./Devoluciones.css";

export default function Devoluciones() {
  const { sesion, rol } = useAuth();
  const navigate = useNavigate();
  const [filtros, setFiltros] = useState({ estado: "", tipo: "", desde: "", hasta: "" });
  const [q, setQ] = useState("");
  const set = (k) => (v) => setFiltros((f) => ({ ...f, [k]: v }));

  const { data, error, loading, reload } = useFetch(
    () => devolucionesService.listar(filtros),
    [filtros.estado, filtros.tipo, filtros.desde, filtros.hasta],
  );

  const datos = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (data || []).filter((d) => !t || [d.id_devolucion, d.id_pedido, nombreCli(d)].join(" ").toLowerCase().includes(t));
  }, [data, q]);

  return (
    <>
      <div className="head">
        <div>
          <h1>Devoluciones y cambios</h1>
          <div className="muted sm">{data ? `${datos.length} resultado${datos.length === 1 ? "" : "s"}` : " "}</div>
        </div>
        <div className="bar">
          <span className="muted sm">{sesion.nombre}, {sesion.puesto || "sin puesto"}</span>
          {PERMISOS.crear.includes(rol) && <Link className="btn pri" to="/nueva">Nueva solicitud</Link>}
        </div>
      </div>
      {!ROLES.includes(rol) && <div className="card sec err">Tu puesto no está entre ADMIN, CAJERO o BODEGUERO: podrás consultar, pero no gestionar devoluciones.</div>}
      <div className="bar">
        <SearchBox label="Buscar" placeholder="Buscar por devolución, pedido o cliente" value={q} onChange={(ev) => setQ(ev.target.value)} />
      </div>
      <ChipBar items={CHIPS.map((e) => [e, e ? ESTADOS[e] : "Todas"])} value={filtros.estado} onChange={set("estado")} />
      <div className="bar">
        <select className="pill" aria-label="Tipo" value={filtros.tipo} onChange={(ev) => set("tipo")(ev.target.value)}>
          <option value="">Todos los tipos</option>
          {TIPOS.map((t) => <option key={t} value={t}>{humanizar(t)}</option>)}
        </select>
        <label className="muted sm">Desde <input className="pill" type="date" value={filtros.desde} onChange={(ev) => set("desde")(ev.target.value)} /></label>
        <label className="muted sm">Hasta <input className="pill" type="date" value={filtros.hasta} onChange={(ev) => set("hasta")(ev.target.value)} /></label>
      </div>
      <div className="stack">
        {loading && !data ? <Cargando>Cargando devoluciones…</Cargando>
          : error ? <ErrorCard message={error} onRetry={reload} />
          : datos.length ? datos.map((d) => (
            <button key={d.id_devolucion} className="card row" onClick={() => navigate(`/devolucion/${d.id_devolucion}`)}>
              <span className="id">#{d.id_devolucion}</span>
              <span>Pedido {d.id_pedido}<br /><span className="muted sm">{nombreCli(d)}</span></span>
              <span>{humanizar(d.tipo)}<br /><span className="muted sm">{humanizar(d.motivo)}</span></span>
              <ChipEstado estado={d.estado} />
              <span className="muted sm">{fecha(d.fecha_solicitud)}</span>
            </button>
          ))
          : <Cargando>No hay devoluciones con estos filtros.</Cargando>}
      </div>
    </>
  );
}
