import { PASOS_PEDIDO, PASO_TEXTO } from "../utils/constants";

/** Avance del pedido: Pedido → Pagado → Enviado → Entregado (o aviso de cancelado). */
export default function PasosPedido({ estado }) {
  if (estado === "CANCELADO") return <p className="err">Este pedido fue cancelado y sus prendas volvieron a la tienda.</p>;
  const actual = PASOS_PEDIDO.indexOf(estado);
  return (
    <ol className="pasos" aria-label="Avance del pedido">
      {PASOS_PEDIDO.map((p, i) => (
        <li key={p} className={i < actual ? "hecho" : i === actual ? "actual" : ""} aria-current={i === actual ? "step" : undefined}>
          <span className="punto" />{PASO_TEXTO[p]}
        </li>
      ))}
    </ol>
  );
}
