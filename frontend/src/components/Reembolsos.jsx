import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import useFetch from "../hooks/useFetch";
import * as reembolsosService from "../services/reembolsosService";
import { dinero, fecha, nombreEmp } from "../utils/format";
import { puede } from "../utils/permisos";
import Modal from "./Modal";

const METODO = { STRIPE: "A la tarjeta (en línea)", EFECTIVO: "Efectivo en caja", TARJETA: "Reversión en POS", PAYPAL: "PayPal" };
const ESTADO = { PENDIENTE: ["Pendiente", ""], COMPLETADO: ["Devuelto", "ok"], FALLIDO: ["Falló", "bad"] };

/**
 * Reembolsos de una devolución o de un pedido (filtro { id_devolucion } o { id_pedido }).
 * Caja marca como entregados los de efectivo/POS/PayPal; los de tarjeta en línea los completa
 * Stripe (si quedaron pendientes se pueden reintentar). `version` fuerza recargar desde afuera.
 */
export default function Reembolsos({ filtro, version = 0 }) {
  const { rol } = useAuth();
  const aviso = useToast();
  const caja = puede(rol, "cobrar");
  const [entregando, setEntregando] = useState(null);
  const [ocupado, setOcupado] = useState(null);
  const { data, error, reload } = useFetch(() => reembolsosService.listar(filtro), [JSON.stringify(filtro), version]);

  if (error) return <section className="card"><h2>Reembolsos</h2><p className="err">{error}</p></section>;
  if (!data || !data.length) return null;

  const reintentar = async (r) => {
    setOcupado(r.id_reembolso);
    try { const x = await reembolsosService.reintentar(r.id_reembolso); aviso(x.message); reload(); }
    catch (e) { aviso(e.message, true); }
    finally { setOcupado(null); }
  };
  const total = data.reduce((s, r) => s + Number(r.monto), 0);

  return (
    <section className="card">
      <h2>Reembolso a la clienta: {dinero(total)}</h2>
      {data.map((r) => (
        <div className="item" key={r.id_reembolso}>
          <div>
            {METODO[r.metodo] || r.metodo}, {dinero(r.monto)}<br />
            <span className="muted sm">
              #{r.id_reembolso}, {fecha(r.fecha_creacion)}
              {r.estado === "COMPLETADO" && r.fecha_completado ? `, devuelto el ${fecha(r.fecha_completado)}` : ""}
              {r.Empleado ? ` por ${nombreEmp(r.Empleado)}` : ""}
              {r.id_transaccion_externa ? `, ref. ${r.id_transaccion_externa}` : ""}
            </span>
            {r.observacion && <><br /><span className="muted sm">{r.observacion}</span></>}
          </div>
          <div className="ctl">
            <span className={`st ${ESTADO[r.estado][1]}`}>{ESTADO[r.estado][0]}</span>
            {caja && ((r.estado === "PENDIENTE" && r.metodo !== "STRIPE") || (r.estado === "FALLIDO" && r.metodo === "STRIPE")) && (
              <button className="btn mini pri" onClick={() => setEntregando(r)}>{r.metodo === "STRIPE" ? "Entregar en efectivo" : "Ya lo entregué"}</button>
            )}
            {caja && r.estado === "PENDIENTE" && r.metodo === "STRIPE" && (
              <button className="btn mini" disabled={ocupado === r.id_reembolso} onClick={() => reintentar(r)}>{ocupado === r.id_reembolso ? "Consultando…" : "Reintentar en Stripe"}</button>
            )}
          </div>
        </div>
      ))}
      {entregando && <EntregarDialog reembolso={entregando} onClose={() => setEntregando(null)} onDone={(msg) => { setEntregando(null); aviso(msg); reload(); }} />}
    </section>
  );
}

function EntregarDialog({ reembolso: r, onClose, onDone }) {
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const enviar = async (ev) => {
    ev.preventDefault();
    setError(""); setEnviando(true);
    try { const x = await reembolsosService.completar(r.id_reembolso, new FormData(ev.currentTarget).get("referencia").trim() || undefined); onDone(x.message); }
    catch (e) { setError(e.message); setEnviando(false); }
  };
  return (
    <Modal onClose={onClose}>
      <form onSubmit={enviar}>
        <h1>Entregar reembolso</h1>
        <p>{r.metodo === "STRIPE" ? "Stripe no pudo devolverlo a la tarjeta; entrégalo en efectivo" : METODO[r.metodo]}: <b>{dinero(r.monto)}</b></p>
        <p className="muted sm">Confirma que le devolviste este dinero a la clienta. Queda registrado con tu nombre.</p>
        <label className="sm muted">{r.metodo === "TARJETA" ? "Número de autorización de la reversión (opcional)" : "Referencia o comprobante (opcional)"}
          <input className="field" name="referencia" maxLength={150} />
        </label>
        <div className="err" role="alert">{error}</div>
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn pri" disabled={enviando}>{enviando ? "Guardando…" : "Sí, ya lo entregué"}</button>
        </div>
      </form>
    </Modal>
  );
}
