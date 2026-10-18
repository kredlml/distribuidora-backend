import { CardElement, Elements, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useState } from "react";
import Icon from "../../components/Icon";
import { STRIPE_PK } from "../../config/env";
import { useAuth } from "../../context/AuthContext";
import * as pedidosService from "../../services/pedidosService";
import { dinero } from "../../utils/format";

// Monto que cobrará la tarjeta: el saldo menos lo que ya está por confirmarse en caja.
const montoTarjeta = (pedido) => pedido.a_pagar_con_tarjeta ?? pedido.saldo;

// Stripe.js se carga una sola vez y solo si hay clave publicable configurada.
const stripePromise = STRIPE_PK ? loadStripe(STRIPE_PK) : null;

const ESTILO_TARJETA = {
  style: {
    base: { fontSize: "16px", color: "#000", fontFamily: "Inter, system-ui, sans-serif", "::placeholder": { color: "#787574" } },
    invalid: { color: "#b3372f" },
  },
  hidePostalCode: true,
};

/**
 * Pago del saldo del pedido. El backend crea (o retoma) el PaymentIntent; aquí se confirma la
 * tarjeta con Stripe.js y luego se pide al backend que sincronice el cobro (no depende del webhook).
 * `onTerminado(mensaje)` se llama al terminar para recargar el pedido.
 */
export default function PagoTarjeta({ pedido, onTerminado }) {
  if (!stripePromise) return <PagoSinClave pedido={pedido} onTerminado={onTerminado} />;
  return (
    <Elements stripe={stripePromise}>
      <FormularioTarjeta pedido={pedido} onTerminado={onTerminado} />
    </Elements>
  );
}

function FormularioTarjeta({ pedido, onTerminado }) {
  const stripe = useStripe();
  const elements = useElements();
  const { cliente } = useAuth();
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [completa, setCompleta] = useState(false);

  const pagar = async (ev) => {
    ev.preventDefault();
    if (!stripe || !elements) return;
    setError(""); setEnviando(true);
    try {
      const r = await pedidosService.iniciarPago(pedido.id_pedido);
      if (r.modo === "simulado") return onTerminado("Pago aprobado.");
      if (r.procesando) {
        const c = await pedidosService.confirmarPago(pedido.id_pedido, r.id_pago);
        return onTerminado(c.message);
      }
      const resultado = await stripe.confirmCardPayment(r.client_secret, {
        payment_method: {
          card: elements.getElement(CardElement),
          billing_details: { name: `${cliente.nombre} ${cliente.apellido}`.trim(), email: cliente.email },
        },
      });
      if (resultado.error) {
        // La tarjeta fue rechazada o falta autenticación: el pago sigue pendiente y se puede reintentar.
        setError(resultado.error.message || "No se pudo completar el pago.");
        return;
      }
      const c = await pedidosService.confirmarPago(pedido.id_pedido, r.id_pago);
      onTerminado(c.estado_pedido === "PENDIENTE" ? c.message : "¡Pago aprobado! Tu pedido ya está en preparación.");
    } catch (e) {
      setError(e.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form className="pago" onSubmit={pagar}>
      <label className="sm muted" htmlFor="tarjeta">Tarjeta de crédito o débito</label>
      <div className="tarjeta" id="tarjeta">
        <CardElement options={ESTILO_TARJETA} onChange={(e) => { setCompleta(e.complete); setError(e.error ? e.error.message : ""); }} />
      </div>
      <div className="err" role="alert">{error}</div>
      <button className="btn pri" disabled={!stripe || enviando || !completa}>
        <Icon name="card" /> {enviando ? "Procesando pago…" : `Pagar ${dinero(montoTarjeta(pedido))}`}
      </button>
      <p className="muted sm">Pago seguro procesado por Stripe. Nunca guardamos los datos de tu tarjeta.</p>
    </form>
  );
}

// Sin clave publicable: solo funciona si el backend está en modo de pago simulado.
function PagoSinClave({ pedido, onTerminado }) {
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const pagar = async () => {
    setError(""); setEnviando(true);
    try {
      const r = await pedidosService.iniciarPago(pedido.id_pedido);
      if (r.modo === "simulado") return onTerminado("Pago aprobado (modo de pruebas).");
      setError("Los pagos con tarjeta no están disponibles: falta configurar VITE_STRIPE_PUBLISHABLE_KEY en la tienda.");
    } catch (e) {
      setError(e.message);
    } finally {
      setEnviando(false);
    }
  };
  return (
    <div className="pago">
      <div className="err" role="alert">{error}</div>
      <button className="btn pri" disabled={enviando} onClick={pagar}><Icon name="card" /> {enviando ? "Procesando…" : `Pagar ${dinero(montoTarjeta(pedido))}`}</button>
    </div>
  );
}
