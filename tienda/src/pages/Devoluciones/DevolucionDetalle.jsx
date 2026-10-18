import { Link, useParams } from "react-router-dom";
import { Cargando, ErrorCard, Pastilla } from "../../components/Estado";
import Imagen from "../../components/Imagen";
import useFetch from "../../hooks/useFetch";
import * as devolucionesService from "../../services/devolucionesService";
import { ESTADO_DEVOLUCION, MOTIVOS_DEVOLUCION, RESULTADO_REVISION, TIPOS_DEVOLUCION } from "../../utils/constants";
import { fecha, fotoDe, variante } from "../../utils/format";
import "./Devoluciones.css";

const TIPO = Object.fromEntries(TIPOS_DEVOLUCION);
const MOTIVO = Object.fromEntries(MOTIVOS_DEVOLUCION);

export default function DevolucionDetalle() {
  const { id } = useParams();
  const res = useFetch(() => devolucionesService.obtener(id), [id]);
  const d = res.data;

  if (res.loading && !d) return <Cargando>Cargando la solicitud…</Cargando>;
  if (res.error) return <ErrorCard message={res.error} onRetry={res.reload} />;
  if (!d) return null;

  return (
    <>
      <Link to="/devoluciones" className="back">← Cambios y devoluciones</Link>
      <div className="head">
        <div><h1>Solicitud #{d.id_devolucion}</h1><div className="muted sm">{TIPO[d.tipo]} · {MOTIVO[d.motivo] || d.motivo} · <Link to={`/pedidos/${d.id_pedido}`}>pedido #{d.id_pedido}</Link></div></div>
        <Pastilla info={ESTADO_DEVOLUCION[d.estado]} />
      </div>
      <div className="cols-pedido">
        <section className="card">
          <h2>Prendas</h2>
          {(d.DetalleDevolucions || []).map((x) => (
            <div className="linea-pedido" key={x.id_detalle_devolucion}>
              <div className="mini-foto"><Imagen src={fotoDe(x.Producto)} alt={(x.Producto && x.Producto.nombre) || ""} /></div>
              <div>
                <div>{x.cantidad} × {x.Producto ? x.Producto.nombre : ""} <span className="muted sm">{x.Producto ? variante(x.Producto) : ""}</span></div>
                {x.ProductoNuevo && <div className="sm">Cambio por: {variante(x.ProductoNuevo) || x.ProductoNuevo.nombre}</div>}
                <div className="muted sm">{RESULTADO_REVISION[x.resultado_revision] || x.resultado_revision}</div>
              </div>
            </div>
          ))}
          {d.observacion && <p className="sm muted sec">Tu comentario: {d.observacion}</p>}
        </section>
        <section className="card">
          <h2>Seguimiento</h2>
          <ul className="tl">
            {(d.historial || []).map((h, i) => (
              <li key={i}><div>{(ESTADO_DEVOLUCION[h.estado] || { texto: h.estado }).texto}</div><div className="muted sm">{fecha(h.fecha, true)}</div></li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
