import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Cargando, ErrorCard, Pastilla } from "../../components/Estado";
import Desglose from "../../components/Desglose";
import Imagen from "../../components/Imagen";
import Modal from "../../components/Modal";
import ReembolsosCliente from "../../components/ReembolsosCliente";
import PasosPedido from "../../components/PasosPedido";
import { useToast } from "../../context/ToastContext";
import useFetch from "../../hooks/useFetch";
import * as pedidosService from "../../services/pedidosService";
import { ESTADO_DEVOLUCION, ESTADO_PEDIDO } from "../../utils/constants";
import { dinero, fecha, fotoDe, variante } from "../../utils/format";
import PagoTarjeta from "./PagoTarjeta";
import "../Pedidos/Pedidos.css";

export default function Pedido() {
  const { id } = useParams();
  const aviso = useToast();
  const res = useFetch(() => pedidosService.obtener(id), [id]);
  const [cancelando, setCancelando] = useState(false);
  const p = res.data;

  if (res.loading && !p) return <Cargando>Cargando el pedido…</Cargando>;
  if (res.error) return <ErrorCard message={res.error} onRetry={res.reload} />;
  if (!p) return null;

  const lineas = p.DetallePedidos || [];
  const pagos = (p.Pagos || []).filter((x) => x.estado_pago === "COMPLETADO");
  const devoluciones = p.Devolucions || [];
  const terminado = (msg) => { if (msg) aviso(msg); res.reload(); };
  const vencido = !!p.pago_vence && new Date(p.pago_vence) <= new Date() && !(p.pago_en_proceso > 0);

  return (
    <>
      <Link to="/pedidos" className="back">← Mis pedidos</Link>
      <div className="head">
        <div><h1>Pedido #{p.id_pedido}</h1><div className="muted sm">{fecha(p.fecha_pedido, true)}</div></div>
        <Pastilla info={ESTADO_PEDIDO[p.estado]} />
      </div>

      <section className="card"><PasosPedido estado={p.estado} /></section>

      {/* Venció el plazo y no hay un cobro con tarjeta en curso: ya no se puede pagar (se cancelará solo). */}
      {p.estado === "PENDIENTE" && vencido && (
        <section className="card sec">
          <h2>El plazo para pagar venció</h2>
          <p className="muted sm">Este pedido se cancelará en breve y sus prendas volverán a la venta. Si aún las quieres, <Link to="/">haz un pedido nuevo</Link>.</p>
        </section>
      )}
      {p.estado === "PENDIENTE" && !vencido && (
        <section className="card sec pagar-card">
          <h2>Completa tu pago</h2>
          <p className="muted sm">
            Tus prendas están reservadas{p.pago_vence ? <> hasta el <b>{fecha(p.pago_vence, true)}</b>; si no se paga antes, el pedido se cancela solo y las prendas vuelven a la venta</> : ""}.
            {" "}El pedido se prepara en cuanto se confirme el pago.
          </p>
          {p.a_pagar_con_tarjeta < p.saldo && (
            <p className="muted sm">Tienes {dinero(p.saldo - p.a_pagar_con_tarjeta)} registrados en tienda pendientes de confirmar; con tarjeta pagas el resto.</p>
          )}
          <PagoTarjeta pedido={p} onTerminado={terminado} />
          <div className="sec"><button className="btn bad mini" onClick={() => setCancelando(true)}>Cancelar pedido</button></div>
        </section>
      )}

      <div className="cols-pedido sec">
        <section className="card">
          <h2>Prendas</h2>
          {lineas.map((l) => (
            <div className="linea-pedido" key={l.id_detalle_pedido}>
              <Link to={`/prenda/${l.Producto ? l.Producto.id_producto_padre || l.Producto.id_producto : l.id_producto}`} className="mini-foto">
                <Imagen src={fotoDe(l.Producto)} alt={(l.Producto && l.Producto.nombre) || ""} />
              </Link>
              <div>
                <div>{l.Producto ? l.Producto.nombre : `Producto #${l.id_producto}`}</div>
                <div className="muted sm">{l.Producto ? variante(l.Producto) : ""} · {l.cantidad} × {dinero(l.precio_unitario)}</div>
              </div>
              <div>{dinero(l.subtotal)}</div>
            </div>
          ))}
          {p.desglose ? <Desglose d={p.desglose} cupon={p.Cupon ? p.Cupon.codigo : ""} /> : <div className="fila total"><span>Total</span><span>{dinero(p.total)}</span></div>}
          {p.pagado > 0 && <div className="fila sm muted"><span>Pagado</span><span>{dinero(p.pagado)}</span></div>}
          {p.estado === "PENDIENTE" && <div className="fila sm"><span>Por pagar</span><span>{dinero(p.saldo)}</span></div>}
        </section>

        <aside className="stack">
          <section className="card">
            <h2>Entrega</h2>
            <div className="sm">{p.direccion_entrega || "Retiro en sucursal"}</div>
            {p.Sucursal && <div className="muted sm sec">Se despacha desde {p.Sucursal.nombre}{p.Sucursal.ciudad ? `, ${p.Sucursal.ciudad}` : ""}.</div>}
          </section>
          {pagos.length > 0 && (
            <section className="card">
              <h2>Pagos</h2>
              {pagos.map((x) => <div className="fila sm" key={x.id_pago}><span>{x.metodo_pago === "STRIPE" ? "Tarjeta" : x.metodo_pago} · {fecha(x.fecha_pago)}</span><span>{dinero(x.monto)}</span></div>)}
            </section>
          )}
          {p.estado === "ENTREGADO" && (
            <section className="card">
              <h2>{devoluciones.length ? "Tu solicitud de cambio o devolución" : "¿Algo no quedó bien?"}</h2>
              {p.devolucion_permitida ? (
                <>
                  <p className="muted sm">Puedes pedir un cambio de talla o color, o devolver prendas de este pedido. Es <b>una sola solicitud</b> y tienes hasta el <b>{fecha(p.devolucion_vence, true)}</b> (24 horas desde la entrega).</p>
                  <Link className="btn mini" to={`/pedidos/${p.id_pedido}/devolucion`}>Solicitar cambio o devolución</Link>
                </>
              ) : !devoluciones.length && (
                <p className="muted sm">El plazo para pedir un cambio o una devolución (24 horas desde la entrega) ya venció.</p>
              )}
              {devoluciones.length > 0 && (
                <div className="sec">
                  {devoluciones.map((d) => (
                    <Link key={d.id_devolucion} to={`/devoluciones/${d.id_devolucion}`} className="fila sm">
                      <span>Solicitud #{d.id_devolucion}</span><Pastilla info={ESTADO_DEVOLUCION[d.estado]} />
                    </Link>
                  ))}
                </div>
              )}
            </section>
          )}
          <ReembolsosCliente reembolsos={p.Reembolsos} />
        </aside>
      </div>

      {cancelando && <CancelarDialog pedido={p} onClose={() => setCancelando(false)} onDone={(msg) => { setCancelando(false); terminado(msg); }} />}
    </>
  );
}

function CancelarDialog({ pedido, onClose, onDone }) {
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const confirmar = async (ev) => {
    ev.preventDefault();
    setError(""); setEnviando(true);
    try {
      await pedidosService.cancelar(pedido.id_pedido);
      onDone("Pedido cancelado.");
    } catch (e) {
      setError(e.message);
      setEnviando(false);
    }
  };
  return (
    <Modal onClose={onClose}>
      <form onSubmit={confirmar}>
        <h1>¿Cancelar el pedido #{pedido.id_pedido}?</h1>
        <p className="muted">Las prendas dejan de estar reservadas para ti. Si iniciaste un pago con tarjeta, también se cancela.</p>
        <div className="err" role="alert">{error}</div>
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>Volver</button>
          <button className="btn pri bad-bg" disabled={enviando}>{enviando ? "Cancelando…" : "Sí, cancelar"}</button>
        </div>
      </form>
    </Modal>
  );
}
