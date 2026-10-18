import { Link } from "react-router-dom";
import { Cargando, ErrorCard, Pastilla, Vacio } from "../../components/Estado";
import useFetch from "../../hooks/useFetch";
import * as devolucionesService from "../../services/devolucionesService";
import { ESTADO_DEVOLUCION, TIPOS_DEVOLUCION } from "../../utils/constants";
import { fecha } from "../../utils/format";
import "./Devoluciones.css";

const TIPO = Object.fromEntries(TIPOS_DEVOLUCION);

export default function MisDevoluciones() {
  const res = useFetch(() => devolucionesService.listar(), []);
  return (
    <>
      <div className="head"><h1>Cambios y devoluciones</h1></div>
      {res.loading && !res.data ? <Cargando>Cargando tus solicitudes…</Cargando>
        : res.error ? <ErrorCard message={res.error} onRetry={res.reload} />
        : res.data.length === 0 ? <Vacio>No tienes solicitudes. Puedes pedir un cambio o devolución desde un pedido entregado en <Link to="/pedidos">Mis pedidos</Link>.</Vacio>
        : (
          <div className="stack">
            {res.data.map((d) => (
              <Link key={d.id_devolucion} to={`/devoluciones/${d.id_devolucion}`} className="card pedido-fila sin-fotos">
                <div className="pedido-info">
                  <div>Solicitud #{d.id_devolucion} · {TIPO[d.tipo] || d.tipo}</div>
                  <div className="muted sm">Pedido #{d.id_pedido} · {fecha(d.fecha_solicitud)} · {(d.DetalleDevolucions || []).reduce((s, x) => s + x.cantidad, 0)} prenda(s)</div>
                </div>
                <Pastilla info={ESTADO_DEVOLUCION[d.estado]} />
              </Link>
            ))}
          </div>
        )}
    </>
  );
}
