import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChipBar, ChipEstado } from "../../components/Chip";
import { Cargando, ErrorCard } from "../../components/Estado";
import Paginador from "../../components/Paginador";
import SearchBox from "../../components/SearchBox";
import { useAuth } from "../../context/AuthContext";
import useDebounced, { useCorregirPagina } from "../../hooks/useDebounced";
import useFetch from "../../hooks/useFetch";
import * as devolucionesService from "../../services/devolucionesService";
import * as reembolsosService from "../../services/reembolsosService";
import { CHIPS, ESTADOS, TIPOS } from "../../utils/constants";
import { dinero, fecha, humanizar, nombreCli } from "../../utils/format";
import { PERMISOS, ROLES, puede } from "../../utils/permisos";
import "../Pedidos/Pedidos.css";
import "./Devoluciones.css";

export default function Devoluciones() {
  const { sesion, rol } = useAuth();
  const navigate = useNavigate();
  const [filtros, setFiltros] = useState({ estado: "", tipo: "", desde: "", hasta: "" });
  const [q, setQEstado] = useState("");
  const [pagina, setPagina] = useState(1);
  // Cambiar un filtro o la búsqueda vuelve a la primera página.
  const set = (k) => (v) => { setFiltros((f) => ({ ...f, [k]: v })); setPagina(1); };
  const setQ = (v) => { setQEstado(v); setPagina(1); };
  const qBuscar = useDebounced(q.trim());

  const { data, error, loading, reload } = useFetch(
    () => devolucionesService.listar({ ...filtros, q: qBuscar, pagina }),
    [filtros.estado, filtros.tipo, filtros.desde, filtros.hasta, qBuscar, pagina],
  );

  useCorregirPagina(data, setPagina);
  const datos = (data && data.datos) || [];

  return (
    <>
      <div className="head">
        <div>
          <h1>Devoluciones y cambios</h1>
          <div className="muted sm">{data ? `${data.total} resultado${data.total === 1 ? "" : "s"}` : " "}</div>
        </div>
        <div className="bar">
          <span className="muted sm">{sesion.nombre}, {sesion.puesto || "sin puesto"}</span>
          {PERMISOS.crear.includes(rol) && <Link className="btn pri" to="/nueva">Nueva solicitud</Link>}
        </div>
      </div>
      {!ROLES.includes(rol) && <div className="card sec err">Tu puesto no está entre ADMIN, CAJERO o BODEGUERO: podrás consultar, pero no gestionar devoluciones.</div>}
      {puede(rol, "cobrar") && <PorEntregar />}
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
        <Paginador datos={data} nombre="solicitudes" onPagina={setPagina} />
      </div>
    </>
  );
}

// Reembolsos que caja aún debe entregar (efectivo, POS, PayPal) o que Stripe no completó.
function PorEntregar() {
  const { data } = useFetch(() => reembolsosService.listar({ estado: "PENDIENTE,FALLIDO" }), []);
  if (!data || !data.length) return null;
  const total = data.reduce((s, r) => s + Number(r.monto), 0);
  return (
    <section className="card sec">
      <h2>Reembolsos por entregar: {dinero(total)}</h2>
      {data.map((r) => (
        <Link className="item fila-pedido" key={r.id_reembolso} to={`/devolucion/${r.id_devolucion}`}>
          <span>
            Devolución #{r.id_devolucion}, {r.Pedido && r.Pedido.Cliente ? nombreCli(r.Pedido) : `pedido ${r.id_pedido}`}<br />
            <span className="muted sm">{r.metodo === "STRIPE" ? (r.estado === "FALLIDO" ? "Stripe lo rechazó: entregar en efectivo" : "A la tarjeta (pendiente en Stripe)") : r.metodo === "TARJETA" ? "Reversión en POS" : r.metodo === "PAYPAL" ? "PayPal" : "Efectivo en caja"}{r.Pedido && r.Pedido.Sucursal ? `, ${r.Pedido.Sucursal.nombre}` : ""}</span>
          </span>
          <b>{dinero(r.monto)}</b>
        </Link>
      ))}
    </section>
  );
}
