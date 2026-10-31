import { useState } from "react";
import useFetch from "../hooks/useFetch";
import * as comprobantesService from "../services/comprobantesService";
import { CONCEPTOS } from "../utils/constants";
import { fecha } from "../utils/format";
import ComprobanteDialog from "./ComprobanteDialog";

/** Comprobantes de mercadería de un pedido o una devolución (filtro: { id_pedido } o { id_devolucion }).
 *  No muestra nada si no tiene (p. ej. un pedido que aún no se paga). */
export default function ComprobantesDe({ filtro, version = 0, className = "card" }) {
  const [abierto, setAbierto] = useState(null);
  const { data } = useFetch(() => comprobantesService.listar(filtro), [JSON.stringify(filtro), version]);
  if (!data || !data.length) return null;
  return (
    <section className={className}>
      <h2>Comprobantes de mercadería</h2>
      {data.map((c) => (
        <button type="button" className="fila-comprobante" key={c.id_comprobante} onClick={() => setAbierto(c.id_comprobante)}>
          <span className="folio-mini">{c.folio}</span>
          <span>{CONCEPTOS[c.concepto] || c.concepto}<br /><span className="muted sm">{fecha(c.fecha)}</span></span>
          <span className="num sm">{c.total_unidades} u. · Ver</span>
        </button>
      ))}
      {abierto && <ComprobanteDialog id={abierto} onClose={() => setAbierto(null)} />}
    </section>
  );
}
