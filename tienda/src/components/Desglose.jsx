import { dinero } from "../utils/format";

/** Subtotal, descuento del cupón, envío, total e IVA incluido (de una cotización o de un pedido). */
export default function Desglose({ d, cupon }) {
  if (!d) return null;
  return (
    <>
      <div className="fila sm"><span>Subtotal</span><span>{dinero(d.subtotal)}</span></div>
      {d.descuento > 0 && <div className="fila sm"><span>Descuento{cupon ? ` (${cupon})` : ""}</span><span>−{dinero(d.descuento)}</span></div>}
      <div className="fila sm"><span>Envío</span><span>{d.costo_envio > 0 ? dinero(d.costo_envio) : "Gratis"}</span></div>
      <div className="fila total"><span>Total</span><span>{dinero(d.total)}</span></div>
      <div className="fila sm muted"><span>IVA incluido ({d.porcentaje}%)</span><span>{dinero(d.iva)}</span></div>
    </>
  );
}
