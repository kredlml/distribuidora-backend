import { useState } from "react";
import useFetch from "../hooks/useFetch";
import * as comprobantesService from "../services/comprobantesService";
import { CONCEPTOS, TIPOS_COMPROBANTE } from "../utils/constants";
import { descargarComprobantePdf } from "../utils/comprobantePdf";
import { dinero, fecha, humanizar, nombreEmp } from "../utils/format";
import { Cargando, ErrorCard } from "./Estado";
import Modal from "./Modal";

/**
 * Muestra un comprobante de entrada o salida y permite descargarlo en PDF. Recibe el comprobante
 * completo (`comprobante`, con sus líneas) o solo su `id` y lo carga.
 */
export default function ComprobanteDialog({ id, comprobante, onClose }) {
  const cargado = useFetch(() => comprobantesService.obtener(id), [id], !comprobante && !!id);
  const c = comprobante || cargado.data;
  const [bajando, setBajando] = useState(false);
  const [error, setError] = useState("");

  const pdf = async () => {
    setError(""); setBajando(true);
    try { await descargarComprobantePdf(c); } catch (e) { setError(`No se pudo generar el PDF: ${e.message}`); }
    setBajando(false);
  };

  return (
    <Modal onClose={onClose} className="ancho">
      {!c ? (
        <div className="stack">
          {cargado.error ? <ErrorCard message={cargado.error} onRetry={cargado.reload} /> : <Cargando>Cargando el comprobante…</Cargando>}
          <div className="acts"><button type="button" className="btn" onClick={onClose}>Cerrar</button></div>
        </div>
      ) : (
        <div className="stack comprobante">
          <div className="head comprobante-cab">
            <div>
              <div className="muted sm">Comprobante de {TIPOS_COMPROBANTE[c.tipo].toLowerCase()}</div>
              <h1 className="folio">{c.folio}</h1>
            </div>
            <span className={`st ${c.tipo === "ENTRADA" ? "ok" : ""}`}>{CONCEPTOS[c.concepto] || c.concepto}</span>
          </div>
          <div className="kv">
            <div><b>Fecha</b>{fecha(c.fecha)}</div>
            <div><b>Sucursal</b>{c.Sucursal ? c.Sucursal.nombre : c.id_sucursal}</div>
            <div><b>Responsable</b>{c.Empleado ? nombreEmp(c.Empleado) : "Sistema (pago en línea)"}</div>
            {c.Proveedor && <div><b>Proveedor</b>{c.Proveedor.nombre_empresa}</div>}
            {c.documento_proveedor && <div><b>Factura o envío</b>{c.documento_proveedor}</div>}
            {c.Pedido && <div><b>Pedido</b>#{c.Pedido.id_pedido}{c.Pedido.Cliente ? `, ${c.Pedido.Cliente.nombre} ${c.Pedido.Cliente.apellido || ""}` : ""}</div>}
            {c.Devolucion && <div><b>Devolución</b>#{c.Devolucion.id_devolucion}, {humanizar(c.Devolucion.tipo)}</div>}
          </div>
          {c.motivo && <p className="sm">{c.motivo}</p>}
          <div className="tabla-scroll">
            <table className="tabla-comprobante">
              <thead>
                <tr><th>Prenda</th><th>Estado</th><th>Lote</th><th className="num">Cant.</th>{c.valor_total != null && <th className="num">Subtotal</th>}</tr>
              </thead>
              <tbody>
                {(c.lineas || []).map((l) => (
                  <tr key={l.id_detalle_comprobante}>
                    <td>{l.descripcion}<br /><span className="muted sm">Prenda #{l.id_producto}{l.valor_unitario != null ? `, ${dinero(l.valor_unitario)} c/u` : ""}</span></td>
                    <td className="sm">{humanizar(l.estado_inventario)}</td>
                    <td className="sm">{l.lote || <span className="muted">—</span>}</td>
                    <td className="num">{l.cantidad}</td>
                    {c.valor_total != null && <td className="num">{l.subtotal != null ? dinero(l.subtotal) : "—"}</td>}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {Number(c.descuento) > 0 && (
                  <tr className="sm"><td colSpan={4}>Descuento (cupón)</td><td className="num">−{dinero(c.descuento)}</td></tr>
                )}
                <tr><td colSpan={3}>Total</td><td className="num">{c.total_unidades}</td>{c.valor_total != null && <td className="num">{dinero(c.valor_total)}</td>}</tr>
              </tfoot>
            </table>
          </div>
          <div className="err" role="alert">{error}</div>
          <div className="acts">
            <button type="button" className="btn" onClick={onClose}>Cerrar</button>
            <button type="button" className="btn pri" disabled={bajando} onClick={pdf}>{bajando ? "Generando…" : "Descargar PDF"}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
