import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Cantidad from "../../components/Cantidad";
import { Cargando, ErrorCard } from "../../components/Estado";
import Icon from "../../components/Icon";
import Imagen from "../../components/Imagen";
import SelectorSucursal from "../../components/SelectorSucursal";
import { MAX_POR_PRENDA, useCart } from "../../context/CartContext";
import { useToast } from "../../context/ToastContext";
import useFetch from "../../hooks/useFetch";
import * as catalogoService from "../../services/catalogoService";
import { dinero } from "../../utils/format";
import "./Prenda.css";

export default function Prenda() {
  const { id } = useParams();
  const navigate = useNavigate();
  const aviso = useToast();
  const { id_sucursal, items, agregar } = useCart();
  const res = useFetch(() => catalogoService.prenda(id), [id]);
  const p = res.data;

  const [color, setColor] = useState(null);
  const [idVariante, setIdVariante] = useState(null);
  const [cantidad, setCantidad] = useState(1);

  const colores = useMemo(() => (p ? [...new Set(p.variantes.map((v) => v.color || ""))] : []), [p]);
  const delColor = useMemo(() => (p ? p.variantes.filter((v) => (v.color || "") === (color ?? colores[0])) : []), [p, color, colores]);
  const stockEn = (v) => (v.stock_por_sucursal && v.stock_por_sucursal[id_sucursal]) || 0;

  if (res.loading && !p) return <Cargando>Cargando la prenda…</Cargando>;
  if (res.error) return <ErrorCard message={res.error} onRetry={res.reload} />;
  if (!p) return null;

  // Variante elegida dentro del color actual; si no hay una (al cargar o al cambiar de color),
  // la primera con stock en esta sucursal. Se calcula en el render: sin parpadeos de precio.
  const v = delColor.find((x) => x.id_producto === idVariante)
    || delColor.find((x) => stockEn(x) > 0) || delColor[0] || p.variantes[0];
  const stock = stockEn(v);
  const enCarrito = (items.find((i) => i.id_producto === v.id_producto) || {}).cantidad || 0;
  const maximo = Math.min(stock - enCarrito, MAX_POR_PRENDA - enCarrito);
  const otras = p.sucursales.filter((s) => s.id_sucursal !== id_sucursal && (v.stock_por_sucursal[s.id_sucursal] || 0) > 0);

  const alCarrito = () => {
    agregar(v, p, Math.min(cantidad, maximo));
    aviso(`${p.nombre} agregada al carrito.`);
    setCantidad(1);
  };

  return (
    <>
      <button className="back" onClick={() => navigate(-1)}><Icon name="back" /> Volver</button>
      <div className="ficha">
        <div className="ficha-foto"><Imagen src={v.imagen_url || p.imagen_url} alt={p.nombre} ancho={1000} /></div>
        <section className="ficha-info">
          <div className="muted sm">{p.categoria ? p.categoria.nombre : ""}</div>
          <h1>{p.nombre}</h1>
          <div className="precio-g">{dinero(v.precio_unitario)}</div>
          {p.descripcion && <p className="muted">{p.descripcion}</p>}

          {colores.length > 1 || colores[0] ? (
            <div className="opcion">
              <div className="sm muted">Color</div>
              <div className="chips">
                {colores.map((c) => (
                  <button key={c || "-"} className={"chip" + ((color ?? colores[0]) === c ? " on" : "")} onClick={() => { setColor(c); setCantidad(1); }}>{c || "Único"}</button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="opcion">
            <div className="sm muted">Talla</div>
            <div className="chips">
              {delColor.map((x) => (
                <button key={x.id_producto} className={"chip" + (x.id_producto === v.id_producto ? " on" : "") + (stockEn(x) <= 0 ? " sin" : "")}
                  onClick={() => { setIdVariante(x.id_producto); setCantidad(1); }} title={stockEn(x) <= 0 ? "Sin stock en esta sucursal" : undefined}>
                  {x.talla || "Única"}
                </button>
              ))}
            </div>
          </div>

          <SelectorSucursal />
          <p className={"sm " + (stock > 0 ? "muted" : "err")}>
            {stock > 0 ? `${stock} disponible${stock > 1 ? "s" : ""} en esta sucursal${enCarrito ? ` (${enCarrito} ya en tu carrito)` : ""}.`
              : "Sin existencias de esta talla en la sucursal elegida."}
          </p>
          {stock <= 0 && otras.length > 0 && (
            <p className="sm muted">Disponible en: {otras.map((s) => s.nombre).join(", ")}.</p>
          )}

          <div className="ctl">
            <Cantidad value={Math.min(cantidad, Math.max(1, maximo))} max={maximo} onChange={setCantidad} />
            <button className="btn pri" disabled={maximo <= 0} onClick={alCarrito}>
              {maximo <= 0 && stock > 0 ? "Ya tienes todo el stock en el carrito" : "Agregar al carrito"}
            </button>
          </div>
          {items.length > 0 && <Link to="/carrito" className="sm">Ver carrito ({items.length})</Link>}
        </section>
      </div>
    </>
  );
}
