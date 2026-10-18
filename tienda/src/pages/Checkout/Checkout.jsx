import { useRef } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Cargando } from "../../components/Estado";
import SelectorSucursal from "../../components/SelectorSucursal";
import { useAuth } from "../../context/AuthContext";
import { useCart } from "../../context/CartContext";
import { useToast } from "../../context/ToastContext";
import useRevisionCarrito from "../../hooks/useRevisionCarrito";
import useSubmit from "../../hooks/useSubmit";
import * as pedidosService from "../../services/pedidosService";
import { dinero, variante } from "../../utils/format";
import "../Carrito/Carrito.css";

export default function Checkout() {
  const { cliente } = useAuth();
  const { items, subtotal, id_sucursal, vaciar } = useCart();
  const revision = useRevisionCarrito();
  const aviso = useToast();
  const navigate = useNavigate();
  // Tras crear el pedido el carrito queda vacío antes de que la navegación (una transition de
  // React Router) se aplique; sin esta marca, la guarda de abajo mandaría al carrito vacío.
  const pedidoCreado = useRef(false);

  const { error, enviando, onSubmit } = useSubmit(async (fd) => {
    const r = await pedidosService.crear({
      id_sucursal,
      direccion_entrega: fd.get("direccion").trim(),
      detalles: items.map((i) => ({ id_producto: i.id_producto, cantidad: i.cantidad })),
    });
    pedidoCreado.current = true;
    vaciar();
    aviso(`Pedido #${r.pedido.id_pedido} creado. Ahora completa el pago.`);
    navigate(`/pedidos/${r.pedido.id_pedido}`, { replace: true });
  });

  if (items.length === 0 && !enviando && !pedidoCreado.current) return <Navigate to="/carrito" replace />;
  if (items.length === 0) return <Cargando>Abriendo tu pedido…</Cargando>;

  return (
    <>
      <div className="head"><h1>Finalizar compra</h1></div>
      <div className="cols-carrito">
        <form className="card stack" onSubmit={onSubmit}>
          <h2>Entrega</h2>
          <div className="sm">{cliente.nombre} {cliente.apellido} · {cliente.email}</div>
          <label className="sm muted">Dirección de entrega
            <textarea className="field" name="direccion" required maxLength={200} defaultValue={cliente.direccion || ""}
              placeholder="Calle, número, zona, municipio y referencias" />
          </label>
          <SelectorSucursal className="field" />
          <p className="muted sm">Al confirmar se reservan las prendas y el pedido queda pendiente de pago. Puedes pagarlo con tarjeta en el siguiente paso o cancelarlo mientras no esté pagado.</p>
          {Object.keys(revision.problemas).length > 0 && (
            <p className="err" role="alert">Hay prendas sin existencias suficientes. <Link to="/carrito">Revisa tu carrito</Link>.</p>
          )}
          <div className="err" role="alert">{error}</div>
          <div><button className="btn pri" disabled={enviando || !revision.listo}>{enviando ? "Creando pedido…" : "Confirmar pedido"}</button></div>
        </form>
        <aside className="card resumen">
          <h2>Tu pedido</h2>
          {revision.loading && !revision.listo ? <Cargando>Revisando existencias…</Cargando> : items.map((i) => (
            <div className="fila sm" key={i.id_producto}>
              <span>{i.cantidad} × {i.nombre}{variante(i) ? ` (${variante(i)})` : ""}</span>
              <span>{dinero(i.cantidad * i.precio_unitario)}</span>
            </div>
          ))}
          <div className="fila total"><span>Total</span><span>{dinero(subtotal)}</span></div>
        </aside>
      </div>
    </>
  );
}
