import { Link, useSearchParams } from "react-router-dom";
import { ChipBar } from "../../components/Chip";
import { Cargando, ErrorCard } from "../../components/Estado";
import Paginador from "../../components/Paginador";
import SearchBox from "../../components/SearchBox";
import Select from "../../components/Select";
import { useAuth } from "../../context/AuthContext";
import useDebounced, { useCorregirPagina } from "../../hooks/useDebounced";
import useFetch from "../../hooks/useFetch";
import * as pedidosService from "../../services/pedidosService";
import * as sucursalesService from "../../services/sucursalesService";
import { ESTADOS_PEDIDO, ORIGENES, TONO_PEDIDO } from "../../utils/constants";
import { dinero, fecha, nombreCli } from "../../utils/format";
import { puede } from "../../utils/permisos";
import "./Pedidos.css";

const NOMBRE_ORIGEN = Object.fromEntries(ORIGENES);

/** Listado de pedidos (tienda y mostrador), paginado y con búsqueda en el servidor. Los filtros
 *  viven en la URL para poder volver a ellos. */
export default function Pedidos() {
  const { rol } = useAuth();
  const [params, setParams] = useSearchParams();
  const f = { estado: params.get("estado") || "", origen: params.get("origen") || "", id_sucursal: params.get("sucursal") || "", id_cliente: params.get("cliente") || "" };
  const q = params.get("q") || "";
  const pagina = Number(params.get("pagina")) || 1;
  // Cambiar un filtro o la búsqueda vuelve a la primera página.
  const cambiar = (clave, valor) => {
    const n = new URLSearchParams(params);
    if (valor) n.set(clave, valor); else n.delete(clave);
    if (clave !== "pagina") n.delete("pagina");
    setParams(n, { replace: true });
  };
  const qBuscar = useDebounced(q.trim());

  const sucs = useFetch(() => sucursalesService.listar(), []);
  const { data, error, loading, reload } = useFetch(() => pedidosService.listar({ ...f, q: qBuscar, pagina }),
    [f.estado, f.origen, f.id_sucursal, f.id_cliente, qBuscar, pagina]);

  useCorregirPagina(data, (n) => cambiar("pagina", String(n)));
  const lista = (data && data.datos) || [];
  const clienteFiltrado = f.id_cliente && !loading && lista[0] && lista[0].Cliente ? nombreCli(lista[0]) : f.id_cliente ? `cliente #${f.id_cliente}` : "";

  return (
    <>
      <div className="head">
        <div><h1>Pedidos</h1><div className="muted sm">Ventas de la tienda en línea y de mostrador. Abre uno para cobrarlo o cambiar su estado.</div></div>
        {puede(rol, "vender") && <Link className="btn pri" to="/pedidos/nueva">Nueva venta</Link>}
      </div>
      {f.id_cliente && (
        <div className="bar"><span className="st">Pedidos de {clienteFiltrado}</span><button className="btn mini" onClick={() => cambiar("cliente", "")}>Ver todos</button></div>
      )}
      <div className="bar">
        <SearchBox label="Buscar" placeholder="Buscar por número de pedido o cliente" value={q} onChange={(ev) => cambiar("q", ev.target.value)} />
      </div>
      <ChipBar items={[["", "Todos"], ...Object.entries(ESTADOS_PEDIDO)]} value={f.estado} onChange={(v) => cambiar("estado", v)} />
      <div className="bar">
        <Select className="pill" aria-label="Origen" value={f.origen} placeholder="Tienda y mostrador" onChange={(ev) => cambiar("origen", ev.target.value)} options={ORIGENES} />
        {puede(rol, "todasLasSucursales") && (
          <Select className="pill" aria-label="Sucursal" value={f.id_sucursal} placeholder="Todas las sucursales" onChange={(ev) => cambiar("sucursal", ev.target.value)}
            options={(sucs.data || []).map((s) => [s.id_sucursal, s.nombre])} />
        )}
      </div>
      <div className="stack">
        {loading && !data ? <Cargando>Cargando pedidos…</Cargando>
          : error ? <ErrorCard message={error} onRetry={reload} />
          : lista.length ? (
            <section className={`card ${loading ? "recargando" : ""}`} aria-busy={loading}>
              <h2>{loading ? "Actualizando…" : `${data.total} pedido${data.total === 1 ? "" : "s"}`}</h2>
              {lista.map((p) => (
                <Link className="item fila-pedido" key={p.id_pedido} to={`/pedidos/${p.id_pedido}`}>
                  <span><b className="num-pedido">#{p.id_pedido}</b> {nombreCli(p)}<br /><span className="muted sm">{fecha(p.fecha_pedido)}, {p.Sucursal ? p.Sucursal.nombre : `Sucursal ${p.id_sucursal}`}</span></span>
                  <span className="ctl">
                    <span className="st">{NOMBRE_ORIGEN[p.origen] || p.origen}</span>
                    <span className={`st ${TONO_PEDIDO[p.estado] || ""}`}>{ESTADOS_PEDIDO[p.estado] || p.estado}</span>
                    <span className="total-pedido">{dinero(p.total)}</span>
                  </span>
                </Link>
              ))}
              <Paginador datos={data} nombre="pedidos" onPagina={(n) => cambiar("pagina", String(n))} />
            </section>
          ) : <Cargando>No hay pedidos con estos filtros.</Cargando>}
      </div>
    </>
  );
}
