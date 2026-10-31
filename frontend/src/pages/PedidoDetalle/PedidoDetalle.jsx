import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import ComprobantesDe from "../../components/ComprobantesDe";
import { Cargando, ErrorCard } from "../../components/Estado";
import Reembolsos from "../../components/Reembolsos";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import useFetch from "../../hooks/useFetch";
import * as pagosService from "../../services/pagosService";
import * as pedidosService from "../../services/pedidosService";
import { ESTADOS, ESTADOS_PAGO, ESTADOS_PEDIDO, METODOS_PAGO, ORIGENES, SIGUIENTE_ESTADO, TONO, TONO_PEDIDO } from "../../utils/constants";
import { dinero, fecha, humanizar, nombreCli, nombreEmp, prod } from "../../utils/format";
import { puede } from "../../utils/permisos";
import AgregarLinea from "./AgregarLinea";
import ConfirmarDialog from "./ConfirmarDialog";
import PagoDialog from "./PagoDialog";
import "../Pedidos/Pedidos.css";

const NOMBRE_ORIGEN = Object.fromEntries(ORIGENES);

export default function PedidoDetalle() {
  const { id } = useParams();
  const { rol } = useAuth();
  const aviso = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [confirmar, setConfirmar] = useState(null); // { titulo, texto, boton, peligro, accion }
  const { data: p, error, loading, reload } = useFetch(() => pedidosService.obtener(id), [id]);

  // ?cobrar=1 (al venir de "Nueva venta") abre directamente el cobro.
  const cobrando = params.get("cobrar") === "1";
  const setCobrando = (on) => { const n = new URLSearchParams(params); if (on) n.set("cobrar", "1"); else n.delete("cobrar"); setParams(n, { replace: true }); };

  if (loading && !p) return <Cargando>Cargando el pedido…</Cargando>;
  if (error) return <><button className="back" onClick={() => navigate("/pedidos")}>← Pedidos</button><ErrorCard message={error} onRetry={reload} /></>;
  if (!p) return null;

  const pendiente = p.estado === "PENDIENTE";
  const cobra = puede(rol, "cobrar");
  const editaLineas = pendiente && cobra;
  const lineas = p.DetallePedidos || [];
  const pagos = p.Pagos || [];
  const siguiente = SIGUIENTE_ESTADO[p.estado];
  const pagosPendientes = pagos.filter((x) => x.estado_pago === "PENDIENTE");

  // Ejecuta una acción, avisa y recarga; los errores se muestran en el diálogo de confirmación.
  // Si falla también se recarga: algunas respuestas de error igual cambiaron datos (p.ej. Stripe
  // ya había cobrado el pago que se quería anular).
  const ejecutar = async (accion, ok) => {
    let r;
    try { r = await accion(); } catch (e) { reload(); throw e; }
    aviso(ok || r.message); setConfirmar(null); reload();
  };
  const presencial = (x) => x.metodo_pago === "EFECTIVO" || x.metodo_pago === "TARJETA";
  const pedirConfirmacion = (c) => setConfirmar(c);

  const cambiarEstado = (estado, titulo, texto, peligro) => pedirConfirmacion({
    titulo, texto, peligro, boton: titulo,
    accion: () => ejecutar(() => pedidosService.cambiarEstado(p.id_pedido, estado), `Pedido #${p.id_pedido}: ${ESTADOS_PEDIDO[estado].toLowerCase()}.`),
  });

  return (
    <>
      <button className="back" onClick={() => (window.history.state && window.history.state.idx > 0 ? navigate(-1) : navigate("/pedidos"))}>← Volver</button>
      <div className="head">
        <div>
          <h1>Pedido #{p.id_pedido}</h1>
          <div className="muted sm">{fecha(p.fecha_pedido)}, {NOMBRE_ORIGEN[p.origen]}{p.Empleado ? `, vendido por ${nombreEmp(p.Empleado)}` : ""}</div>
        </div>
        <span className={`st ${TONO_PEDIDO[p.estado] || ""}`}>{ESTADOS_PEDIDO[p.estado] || p.estado}</span>
      </div>

      <div className="stack">
        {/* Acciones del estado actual */}
        {(pendiente || siguiente) && (
          <section className="card">
            <h2>{pendiente ? (p.saldo > 0 ? `Falta cobrar ${dinero(p.saldo)}` : lineas.length ? "Nada por cobrar" : "Pedido sin productos") : "Siguiente paso"}</h2>
            {pendiente && p.por_confirmar > 0 && <p className="muted sm">Hay {dinero(p.por_confirmar)} en pagos por confirmar.</p>}
            {pendiente && <p className="muted sm">Las prendas ya están reservadas. Cuando los pagos completados cubren el total, el pedido pasa solo a «Pagado».</p>}
            {pendiente && p.pago_vence && (
              <p className="sm">
                {new Date(p.pago_vence) <= new Date() ? "Venció el plazo de pago" : "Si no se paga, se cancela solo el"} <b>{fecha(p.pago_vence)}</b>
                {p.pagado > 0 || pagosPendientes.length ? " (no se cancelará mientras tenga pagos registrados)." : " y las prendas vuelven al stock."}
              </p>
            )}
            {siguiente && <p className="muted sm">{siguiente.texto}</p>}
            <div className="acciones-pedido">
              {pendiente && cobra && p.por_cobrar > 0 && <button className="btn pri" onClick={() => setCobrando(true)}>Registrar pago</button>}
              {siguiente && puede(rol, siguiente.estado) && (
                <button className="btn pri" onClick={() => cambiarEstado(siguiente.estado, siguiente.boton, siguiente.texto)}>{siguiente.boton}</button>
              )}
              {siguiente && !puede(rol, siguiente.estado) && <span className="muted sm">Este paso lo hace bodega (ADMIN o BODEGUERO).</span>}
              {pendiente && puede(rol, "CANCELADO") && !(p.pagado > 0) && !pagosPendientes.length && (
                <button className="btn bad" onClick={() => cambiarEstado("CANCELADO", "Cancelar pedido",
                  "Las prendas vuelven al stock de la sucursal. No se puede deshacer.", true)}>Cancelar pedido</button>
              )}
            </div>
            {pendiente && puede(rol, "CANCELADO") && (p.pagado > 0 || pagosPendientes.length > 0) && (
              <p className="muted sm">Para cancelar el pedido, primero {p.pagado > 0 ? "devuelve los cobros en efectivo o tarjeta" : ""}{p.pagado > 0 && pagosPendientes.length ? " y " : ""}{pagosPendientes.length ? "anula los pagos por confirmar" : ""} (abajo, en Pagos).</p>
            )}
          </section>
        )}

        <div className="cols">
          <section className="card">
            <h2>Cliente</h2>
            <div>{nombreCli(p)}</div>
            <div className="muted sm">{[p.Cliente && p.Cliente.email, p.Cliente && p.Cliente.telefono].filter(Boolean).join(", ") || "Sin datos de contacto"}</div>
            {p.Cliente && <div className="sm sec"><Link to={`/pedidos?cliente=${p.id_cliente}`}>Ver todos sus pedidos</Link></div>}
          </section>
          <section className="card">
            <h2>Entrega</h2>
            <div>{p.direccion_entrega || "Retiro en sucursal"}</div>
            <div className="muted sm">Sucursal {p.Sucursal ? `${p.Sucursal.nombre}${p.Sucursal.ciudad ? ", " + p.Sucursal.ciudad : ""}` : p.id_sucursal}</div>
            <div className="sm sec"><Link to={`/trazabilidad?pedido=${p.id_pedido}`}>Ver trazabilidad del pedido</Link></div>
          </section>
        </div>

        <section className="card">
          <h2>Prendas</h2>
          <div className="lineas">
            {lineas.length ? lineas.map((l) => (
              <div className="linea" key={l.id_detalle_pedido}>
                <span>{prod(l.Producto)}<br /><span className="muted sm">Prenda #{l.id_producto}, {l.cantidad} × {dinero(l.precio_unitario)}</span></span>
                <span className="muted sm">{l.cantidad} u.</span>
                <span className="num">{dinero(l.subtotal)}</span>
                {editaLineas ? (
                  <button className="btn mini bad" onClick={() => pedirConfirmacion({
                    titulo: "Quitar prenda", boton: "Quitar", peligro: true,
                    texto: `${prod(l.Producto)} (${l.cantidad} u.) sale del pedido y vuelve al stock. El total se recalcula solo.`,
                    accion: () => ejecutar(() => pedidosService.quitarLinea(l.id_detalle_pedido), "Prenda quitada del pedido."),
                  })}>Quitar</button>
                ) : <span />}
              </div>
            )) : <p className="muted">El pedido no tiene prendas.</p>}
          </div>
          {editaLineas && <AgregarLinea pedido={p} onAgregada={() => { aviso("Prenda agregada."); reload(); }} />}
          <div className="sec">
            {p.desglose && (p.desglose.descuento > 0 || p.desglose.costo_envio > 0) && (
              <>
                <div className="fila-total sm"><span>Subtotal</span><span>{dinero(p.desglose.subtotal)}</span></div>
                {p.desglose.descuento > 0 && <div className="fila-total sm"><span>Descuento{p.Cupon ? ` (cupón ${p.Cupon.codigo})` : ""}</span><span>−{dinero(p.desglose.descuento)}</span></div>}
                {p.desglose.costo_envio > 0 && <div className="fila-total sm"><span>Envío</span><span>{dinero(p.desglose.costo_envio)}</span></div>}
              </>
            )}
            <div className="fila-total grande"><span>Total</span><span>{dinero(p.total)}</span></div>
            {p.desglose && <div className="fila-total sm muted"><span>IVA incluido ({p.desglose.porcentaje}%)</span><span>{dinero(p.desglose.iva)}</span></div>}
            <div className="fila-total sm muted"><span>Pagado</span><span>{dinero(p.pagado)}</span></div>
            {pendiente && <div className="fila-total sm"><span>Saldo</span><span>{dinero(p.saldo)}</span></div>}
          </div>
        </section>

        <section className="card">
          <h2>Pagos</h2>
          {pagos.length ? pagos.map((x) => (
            <div className="item" key={x.id_pago}>
              <div>
                {METODOS_PAGO[x.metodo_pago] || x.metodo_pago}, {dinero(x.monto)}<br />
                <span className="muted sm">#{x.id_pago}, {fecha(x.fecha_pago)}{x.id_transaccion_externa && x.metodo_pago === "TARJETA" ? `, ref. ${x.id_transaccion_externa}` : ""}</span>
              </div>
              <div className="ctl">
                <span className={`st ${x.estado_pago === "COMPLETADO" ? "ok" : x.estado_pago === "FALLIDO" || x.estado_pago === "REEMBOLSADO" ? "bad" : ""}`}>{ESTADOS_PAGO[x.estado_pago] || x.estado_pago}</span>
                {x.estado_pago === "COMPLETADO" && presencial(x) && cobra && pendiente && (
                  <button className="btn mini bad" onClick={() => pedirConfirmacion({
                    titulo: "Devolver pago", boton: "Ya lo devolví", peligro: true,
                    texto: `Registra que le devolviste ${dinero(x.monto)} al cliente (${METODOS_PAGO[x.metodo_pago]}). El monto vuelve a quedar por cobrar y, sin pagos, podrás cancelar el pedido.`,
                    accion: () => ejecutar(() => pagosService.devolver(x.id_pago)),
                  })}>Devolver</button>
                )}
                {x.estado_pago === "PENDIENTE" && cobra && pendiente && (
                  <>
                    {x.metodo_pago !== "STRIPE" && <button className="btn mini" onClick={() => pedirConfirmacion({
                      titulo: "Confirmar pago", boton: "Confirmar pago",
                      texto: `Confirma que recibiste ${dinero(x.monto)} por ${METODOS_PAGO[x.metodo_pago] || x.metodo_pago}.`,
                      accion: () => ejecutar(() => pagosService.confirmar(x.id_pago)),
                    })}>Confirmar</button>}
                    <button className="btn mini bad" onClick={() => pedirConfirmacion({
                      titulo: "Anular pago", boton: "Anular pago", peligro: true,
                      texto: "El pago queda anulado y su monto vuelve a estar por cobrar.",
                      accion: () => ejecutar(() => pagosService.anular(x.id_pago)),
                    })}>Anular</button>
                  </>
                )}
              </div>
            </div>
          )) : <p className="muted">Sin pagos registrados.</p>}
        </section>

        {/* Salida de la venta (al pagarse) y entradas/salidas de sus devoluciones o cambios. */}
        {!pendiente && <ComprobantesDe filtro={{ id_pedido: p.id_pedido }} version={`${p.estado}-${(p.Devolucions || []).map((d) => d.estado).join()}`} />}

        {(p.Devolucions || []).length > 0 && (
          <section className="card">
            <h2>Devoluciones y cambios</h2>
            {p.Devolucions.map((d) => (
              <Link className="item fila-pedido" key={d.id_devolucion} to={`/devolucion/${d.id_devolucion}`}>
                <span>Solicitud #{d.id_devolucion}, {humanizar(d.tipo)}</span>
                <span className={`st ${TONO[d.estado] || ""}`}>{ESTADOS[d.estado] || d.estado}</span>
              </Link>
            ))}
          </section>
        )}

        {(p.Devolucions || []).length > 0 && <Reembolsos filtro={{ id_pedido: p.id_pedido }} />}
      </div>

      {cobrando && pendiente && cobra && p.por_cobrar > 0 && (
        <PagoDialog pedido={p} onClose={() => setCobrando(false)} onDone={(msg) => { setCobrando(false); aviso(msg); reload(); }} />
      )}
      {confirmar && <ConfirmarDialog {...confirmar} onClose={() => setConfirmar(null)} />}
    </>
  );
}
