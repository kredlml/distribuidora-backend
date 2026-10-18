import { Link } from "react-router-dom";
import Imagen from "../../components/Imagen";
import { rangoPrecio } from "../../utils/format";

/** Tarjeta de una prenda en la grilla del catálogo. */
export default function TarjetaPrenda({ prenda: p }) {
  const tallas = [...new Set(p.variantes.filter((v) => v.stock > 0).map((v) => v.talla).filter(Boolean))];
  const colores = [...new Set(p.variantes.map((v) => v.color).filter(Boolean))];
  const agotada = p.stock <= 0;
  return (
    <Link to={`/prenda/${p.id_prenda}`} className={"prenda" + (agotada ? " agotada" : "")}>
      <div className="foto">
        <Imagen src={p.imagen_url} alt={p.nombre} />
        {agotada && <span className="st bad flota">Agotado aquí</span>}
      </div>
      <div className="info">
        <div className="nombre">{p.nombre}</div>
        <div className="muted sm">{p.categoria ? p.categoria.nombre : ""}{colores.length ? ` · ${colores.length} color${colores.length > 1 ? "es" : ""}` : ""}</div>
        <div className="precio">{rangoPrecio(p)}</div>
        {tallas.length > 0 && <div className="tallas">{tallas.map((t) => <span key={t}>{t}</span>)}</div>}
      </div>
    </Link>
  );
}
