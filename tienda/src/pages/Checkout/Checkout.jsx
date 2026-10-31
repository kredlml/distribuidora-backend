import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import Desglose from "../../components/Desglose";
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
  const { items, id_sucursal, vaciar } = useCart();
  const revision = useRevisionCarrito();
  const aviso = useToast();
  const navigate = useNavigate();
  // Tras crear el pedido el carrito queda vacío antes de que la navegación (una transition de
  // React Router) se aplique; sin esta marca, la guarda de abajo mandaría al carrito vacío.
  const pedidoCreado = useRef(false);
  const [retiro, setRetiro] = useState(false);
  const [codigo, setCodigo] = useState("");     // lo que escribe
  const [cupon, setCupon] = useState("");       // el que se aplicó
  const [cotizacion, setCotizacion] = useState(null);
  const [errorCotizar, setErrorCotizar] = useState("");

  // El servidor calcula el total real (precios del catálogo, cupón y envío).
  const detalles = items.map((i) => ({ id_producto: i.id_producto, cantidad: i.cantidad }));
  const clave = JSON.stringify([id_sucursal, detalles, cupon, retiro]);
  useEffect(() => {
    if (!items.length) return;
    let vivo = true;
    pedidosService.cotizar({ id_sucursal, detalles, cupon: cupon || undefined, retiro_en_sucursal: retiro })
      .then((c) => { if (vivo) { setCotizacion({ ...c, clave }); setErrorCotizar(""); } })
      .catch((e) => vivo && setErrorCotizar(e.message));
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  const { error, enviando, onSubmit } = useSubmit(async (fd) => {
    const r = await pedidosService.crear({
      id_sucursal,
      retiro_en_sucursal: retiro,
      direccion_entrega: retiro ? undefined : fd.get("direccion").trim(),
      // El cupón aplicado se manda siempre que la cotización vigente no lo rechace; el servidor
      // lo vuelve a validar (si dejó de aplicar, responde con el motivo y no se crea el pedido).
      cupon: cupon && !cotizacion.cupon_error ? cupon : undefined,
      detalles,
    });
    pedidoCreado.current = true;
    vaciar();
    aviso(`Pedido #${r.pedido.id_pedido} creado. Ahora completa el pago.`);
    navigate(`/pedidos/${r.pedido.id_pedido}`, { replace: true });
  });

  if (items.length === 0 && !enviando && !pedidoCreado.current) return <Navigate to="/carrito" replace />;
  if (items.length === 0) return <Cargando>Abriendo tu pedido…</Cargando>;
  // Solo vale la cotización del carrito, la entrega y el cupón que se ven ahora (no una anterior).
  const vigente = !!cotizacion && cotizacion.clave === clave;
  const cuponAplicado = vigente && cotizacion.cupon;

  return (
    <>
      <div className="head"><h1>Finalizar compra</h1></div>
      <div className="cols-carrito">
        <form className="card stack" onSubmit={onSubmit}>
          <h2>Entrega</h2>
          <div className="sm">{cliente.nombre} {cliente.apellido} · {cliente.email}</div>
          <div className="stack" role="radiogroup" aria-label="Forma de entrega">
            <label className="sm"><input type="radio" name="entrega" checked={!retiro} onChange={() => setRetiro(false)} /> Envío a domicilio</label>
            <label className="sm"><input type="radio" name="entrega" checked={retiro} onChange={() => setRetiro(true)} /> Retiro en la sucursal (sin costo de envío)</label>
          </div>
          {!retiro && (
            <label className="sm muted">Dirección de entrega
              <textarea className="field" name="direccion" required maxLength={200} defaultValue={cliente.direccion || ""}
                placeholder="Calle, número, zona, municipio y referencias" />
            </label>
          )}
          <SelectorSucursal className="field" etiqueta={retiro ? "Sucursal donde la retiras" : "Enviar desde"} />
          <div className="stack">
            <label className="sm muted">Cupón de descuento
              <span className="ctl">
                <input className="field" value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} maxLength={30} placeholder="Escribe tu código"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setCupon(codigo.trim()); } }} />
                <button type="button" className="btn mini" onClick={() => setCupon(codigo.trim())} disabled={!codigo.trim()}>Aplicar</button>
                {cupon && <button type="button" className="btn mini" onClick={() => { setCupon(""); setCodigo(""); }}>Quitar</button>}
              </span>
            </label>
            {cupon && vigente && cotizacion.cupon_error && <p className="err sm" role="alert">{cotizacion.cupon_error}</p>}
            {cuponAplicado && <p className="sm">Cupón {cotizacion.cupon.codigo} aplicado{cotizacion.cupon.descripcion ? `: ${cotizacion.cupon.descripcion}` : ""}.</p>}
          </div>
          <p className="muted sm">Al confirmar se reservan las prendas y el pedido queda pendiente de pago. Puedes pagarlo con tarjeta en el siguiente paso o cancelarlo mientras no esté pagado.</p>
          {Object.keys(revision.problemas).length > 0 && (
            <p className="err" role="alert">Hay prendas sin existencias suficientes. <Link to="/carrito">Revisa tu carrito</Link>.</p>
          )}
          <div className="err" role="alert">{error || errorCotizar}</div>
          <div><button className="btn pri" disabled={enviando || !revision.listo || !vigente}>{enviando ? "Creando pedido…" : "Confirmar pedido"}</button></div>
        </form>
        <aside className="card resumen">
          <h2>Tu pedido</h2>
          {revision.loading && !revision.listo ? <Cargando>Revisando existencias…</Cargando> : items.map((i) => (
            <div className="fila sm" key={i.id_producto}>
              <span>{i.cantidad} × {i.nombre}{variante(i) ? ` (${variante(i)})` : ""}</span>
              <span>{dinero(i.cantidad * i.precio_unitario)}</span>
            </div>
          ))}
          {vigente ? <Desglose d={cotizacion} cupon={cuponAplicado ? cotizacion.cupon.codigo : ""} /> : errorCotizar ? null : <Cargando>Calculando total…</Cargando>}
        </aside>
      </div>
    </>
  );
}
