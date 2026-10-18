import { Link, useNavigate } from "react-router-dom";
import Cantidad from "../../components/Cantidad";
import { ErrorCard, Vacio } from "../../components/Estado";
import Icon from "../../components/Icon";
import Imagen from "../../components/Imagen";
import SelectorSucursal from "../../components/SelectorSucursal";
import { MAX_POR_PRENDA, useCart } from "../../context/CartContext";
import useRevisionCarrito from "../../hooks/useRevisionCarrito";
import { dinero, variante } from "../../utils/format";
import "./Carrito.css";

export default function Carrito() {
  const { items, subtotal, cambiarCantidad, quitar } = useCart();
  const revision = useRevisionCarrito();
  const navigate = useNavigate();

  if (items.length === 0) {
    return (
      <>
        <div className="head"><h1>Tu carrito</h1></div>
        <Vacio>Tu carrito está vacío. <Link to="/">Ver el catálogo</Link></Vacio>
      </>
    );
  }

  return (
    <>
      <div className="head"><h1>Tu carrito</h1><SelectorSucursal /></div>
      {revision.error && <ErrorCard message={revision.error} onRetry={revision.reload} />}
      <div className="cols-carrito">
        <section className="card">
          {items.map((i) => (
            <div className="linea" key={i.id_producto}>
              <Link to={`/prenda/${i.id_prenda}`} className="mini-foto"><Imagen src={i.imagen_url} alt={i.nombre} /></Link>
              <div className="linea-info">
                <Link to={`/prenda/${i.id_prenda}`} className="nombre">{i.nombre}</Link>
                <div className="muted sm">{variante(i) || "Talla única"}</div>
                <div className="sm">{dinero(i.precio_unitario)} c/u</div>
                {revision.problemas[i.id_producto] && <div className="err sm" role="alert">{revision.problemas[i.id_producto]}</div>}
              </div>
              <div className="linea-ctl">
                <Cantidad value={i.cantidad} max={MAX_POR_PRENDA} onChange={(n) => cambiarCantidad(i.id_producto, n)} />
                <div>{dinero(i.cantidad * i.precio_unitario)}</div>
                <button className="btn mini" aria-label={`Quitar ${i.nombre}`} onClick={() => quitar(i.id_producto)}><Icon name="trash" /></button>
              </div>
            </div>
          ))}
        </section>
        <aside className="card resumen">
          <h2>Resumen</h2>
          <div className="fila"><span>Subtotal</span><span>{dinero(subtotal)}</span></div>
          <div className="fila muted sm"><span>Envío</span><span>Sin costo</span></div>
          <div className="fila total"><span>Total</span><span>{dinero(subtotal)}</span></div>
          <p className="muted sm">El total final se confirma al crear el pedido con los precios vigentes.</p>
          <button className="btn pri ancho" disabled={!revision.listo} onClick={() => navigate("/checkout")}>
            {revision.loading ? "Revisando existencias…" : "Continuar con la compra"}
          </button>
        </aside>
      </div>
    </>
  );
}
