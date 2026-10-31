import { dinero, fecha } from "../utils/format";

// Estado de los reembolsos de la clienta (por una devolución, la diferencia de un cambio o un cobro
// que no correspondía). Qué debe hacer depende de cómo pagó.
const TEXTO = {
  STRIPE: { PENDIENTE: "Procesando el reembolso a tu tarjeta.", COMPLETADO: "Devuelto a tu tarjeta. Según tu banco puede tardar de 5 a 10 días hábiles en verse.", FALLIDO: "No se pudo devolver a tu tarjeta: pasa por la sucursal y te lo entregamos en efectivo." },
  EFECTIVO: { PENDIENTE: "Listo para recogerlo en efectivo en la sucursal: acércate a caja.", COMPLETADO: "Entregado en efectivo en la sucursal." },
  TARJETA: { PENDIENTE: "Se revierte en la tarjeta con la que pagaste en la sucursal; si caja te lo pide, acércate con tu tarjeta.", COMPLETADO: "Revertido en tu tarjeta." },
  PAYPAL: { PENDIENTE: "Te lo devolveremos a tu cuenta de PayPal.", COMPLETADO: "Devuelto a tu cuenta de PayPal." },
};

export default function ReembolsosCliente({ reembolsos }) {
  if (!reembolsos || !reembolsos.length) return null;
  return (
    <section className="card">
      <h2>Tu reembolso</h2>
      {reembolsos.map((r) => (
        <div className="sec" key={r.id_reembolso}>
          <div className="fila sm"><b>{dinero(r.monto)}</b><span className="muted">{fecha(r.estado === "COMPLETADO" && r.fecha_completado ? r.fecha_completado : r.fecha_creacion)}</span></div>
          <div className="muted sm">{(TEXTO[r.metodo] || TEXTO.EFECTIVO)[r.estado] || ""}</div>
        </div>
      ))}
    </section>
  );
}
