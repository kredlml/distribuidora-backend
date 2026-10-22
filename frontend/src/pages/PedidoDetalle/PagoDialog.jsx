import { useState } from "react";
import Modal from "../../components/Modal";
import useSubmit from "../../hooks/useSubmit";
import * as pagosService from "../../services/pagosService";
import { dinero } from "../../utils/format";

const METODOS = [
  ["EFECTIVO", "Efectivo", "Se registra como cobrado al instante."],
  ["TARJETA", "Tarjeta (POS)", "Cobro en el terminal de la tienda. Se registra como cobrado al instante."],
  ["PAYPAL", "PayPal", "Queda por confirmar hasta que verifiques que el dinero llegó."],
];

/** Cobro en caja de un pedido PENDIENTE. Por defecto propone el saldo completo. */
export default function PagoDialog({ pedido, onClose, onDone }) {
  const [metodo, setMetodo] = useState("EFECTIVO");
  const [monto, setMonto] = useState(pedido.por_cobrar.toFixed(2));
  const [recibido, setRecibido] = useState("");
  const montoNum = Number(monto);
  const montoValido = monto !== "" && montoNum > 0 && montoNum <= pedido.por_cobrar && /^\d+(\.\d{1,2})?$/.test(monto);
  const vuelto = recibido !== "" && montoValido ? Number(recibido) - montoNum : null;

  const { error, enviando, onSubmit } = useSubmit(async (fd) => {
    if (!montoValido) throw new Error(`El monto debe ser mayor a 0, con hasta 2 decimales, y no mayor a ${dinero(pedido.por_cobrar)}.`);
    if (metodo === "EFECTIVO" && vuelto !== null && vuelto < 0) throw new Error("El efectivo recibido no alcanza para el monto.");
    const r = await pagosService.registrar({
      id_pedido: pedido.id_pedido, metodo_pago: metodo, monto: montoNum,
      referencia: metodo === "TARJETA" ? (fd.get("referencia") || "").trim() || undefined : undefined,
    });
    onDone(r.estado_pedido === "PROCESADO" ? `Pago registrado. Pedido #${pedido.id_pedido} pagado.` : "Pago registrado.");
  });

  return (
    <Modal onClose={onClose}>
      <form onSubmit={onSubmit}>
        <h1>Registrar pago</h1>
        <p className="muted sm">Pedido #{pedido.id_pedido}, por cobrar {dinero(pedido.por_cobrar)}.</p>
        <fieldset className="metodos" aria-label="Método de pago">
          {METODOS.map(([v, t]) => (
            <label key={v}><input type="radio" name="metodo" value={v} checked={metodo === v} onChange={() => setMetodo(v)} />{t}</label>
          ))}
        </fieldset>
        <p className="muted sm">{METODOS.find((m) => m[0] === metodo)[2]}</p>
        <label className="sm muted">Monto a cobrar
          <input className="field" type="number" step="0.01" min="0.01" max={pedido.por_cobrar} required value={monto} onChange={(e) => setMonto(e.target.value)}
            aria-invalid={monto !== "" && !montoValido} aria-describedby="ayuda-monto" />
        </label>
        {monto !== "" && !montoValido && (
          <p id="ayuda-monto" className="err sm">
            El monto debe ser mayor a 0, con hasta 2 decimales, y como máximo {dinero(pedido.por_cobrar)}.
            {metodo === "EFECTIVO" && montoNum > pedido.por_cobrar ? " Si el cliente te dio más, escríbelo en «Efectivo recibido» para calcular el vuelto." : ""}
          </p>
        )}
        {metodo === "EFECTIVO" && (
          <>
            <label className="sm muted">Efectivo recibido (opcional, para calcular el vuelto)
              <input className="field" type="number" step="0.01" min="0" value={recibido} onChange={(e) => setRecibido(e.target.value)} />
            </label>
            {vuelto !== null && <p className={`vuelto ${vuelto < 0 ? "err" : ""}`}>{vuelto < 0 ? `Faltan ${dinero(-vuelto)}` : `Vuelto: ${dinero(vuelto)}`}</p>}
          </>
        )}
        {metodo === "TARJETA" && (
          <label className="sm muted">Número de autorización del voucher (opcional)<input className="field" name="referencia" maxLength={150} /></label>
        )}
        <div className="err" role="alert">{error}</div>
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn pri" disabled={enviando || !montoValido}>{enviando ? "Registrando…" : `Cobrar ${montoValido ? dinero(montoNum) : ""}`}</button>
        </div>
      </form>
    </Modal>
  );
}
