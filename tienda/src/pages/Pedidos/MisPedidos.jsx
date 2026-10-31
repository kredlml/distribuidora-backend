import { Link } from "react-router-dom";
import { Cargando, ErrorCard, Pastilla, Vacio } from "../../components/Estado";
import Imagen from "../../components/Imagen";
import useFetch from "../../hooks/useFetch";
import * as pedidosService from "../../services/pedidosService";
import { ESTADO_PEDIDO } from "../../utils/constants";
import { dinero, fecha, fotoDe } from "../../utils/format";
import "./Pedidos.css";

export default function MisPedidos() {
  const res = useFetch(() => pedidosService.listar(), []);

  return (
    <>
      <div className="head"><h1>Mis pedidos</h1></div>
      {res.loading && !res.data ? <Cargando>Cargando tus pedidos…</Cargando>
        : res.error ? <ErrorCard message={res.error} onRetry={res.reload} />
        : res.data.length === 0 ? <Vacio>Aún no tienes pedidos. <Link to="/">Ver el catálogo</Link></Vacio>
        : (
          <div className="stack">
            {res.data.map((p) => {
              const lineas = p.DetallePedidos || [];
              const unidades = lineas.reduce((s, l) => s + l.cantidad, 0);
              return (
                <Link key={p.id_pedido} to={`/pedidos/${p.id_pedido}`} className="card pedido-fila">
                  <div className="fotos">
                    {lineas.slice(0, 3).map((l) => <Imagen key={l.id_detalle_pedido} src={fotoDe(l.Producto)} alt={(l.Producto && l.Producto.nombre) || ""} />)}
                  </div>
                  <div className="pedido-info">
                    <div>Pedido #{p.id_pedido}</div>
                    <div className="muted sm">{fecha(p.fecha_pedido)} · {unidades} prenda{unidades === 1 ? "" : "s"}{p.Sucursal ? ` · desde ${p.Sucursal.nombre}` : ""}</div>
                    {p.pago_vence && <div className="sm">Págalo antes del {fecha(p.pago_vence, true)}</div>}
                  </div>
                  <div className="pedido-der">
                    <Pastilla info={ESTADO_PEDIDO[p.estado]} />
                    <div>{dinero(p.total)}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
    </>
  );
}
