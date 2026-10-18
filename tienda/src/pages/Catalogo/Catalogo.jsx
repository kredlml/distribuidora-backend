import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Cargando, ErrorCard, Vacio } from "../../components/Estado";
import Icon from "../../components/Icon";
import SelectorSucursal from "../../components/SelectorSucursal";
import { useCart } from "../../context/CartContext";
import useFetch from "../../hooks/useFetch";
import * as catalogoService from "../../services/catalogoService";
import TarjetaPrenda from "./TarjetaPrenda";
import "./Catalogo.css";

export default function Catalogo() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || "";
  const cat = params.get("cat") || "";
  const [texto, setTexto] = useState(q);
  const { id_sucursal } = useCart();

  const categorias = useFetch(() => catalogoService.categorias(), []);
  // Sin sucursal elegida (aún cargando o no hay ninguna activa) se muestra el stock total.
  const prendas = useFetch(() => catalogoService.listar({ q, id_categoria: cat, id_sucursal }), [q, cat, id_sucursal]);

  const filtrar = (cambios) => {
    const n = new URLSearchParams(params);
    Object.entries(cambios).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k)));
    setParams(n, { replace: true });
  };
  const buscar = (ev) => { ev.preventDefault(); filtrar({ q: texto.trim() }); };

  return (
    <>
      <section className="hero">
        <div>
          <h1>Ropa para todos los días</h1>
          <p className="muted">Elige tu talla y color, paga con tarjeta y recíbelo en tu casa. Cambios de talla sin complicaciones.</p>
        </div>
        <SelectorSucursal />
      </section>

      <div className="bar">
        <form className="search" role="search" onSubmit={buscar}>
          <input aria-label="Buscar prendas" placeholder="Buscar por prenda, color o talla" value={texto} onChange={(e) => setTexto(e.target.value)} />
          <button className="go" aria-label="Buscar"><Icon name="search" /></button>
        </form>
      </div>
      <div className="chips" role="group" aria-label="Tipo de prenda">
        <button className={"chip" + (!cat ? " on" : "")} onClick={() => filtrar({ cat: "" })}>Todo</button>
        {(categorias.data || []).map((c) => (
          <button key={c.id_categoria} className={"chip" + (String(c.id_categoria) === cat ? " on" : "")} onClick={() => filtrar({ cat: String(c.id_categoria) })}>{c.nombre}</button>
        ))}
      </div>

      {prendas.loading && !prendas.data ? <Cargando>Cargando el catálogo…</Cargando>
        : prendas.error ? <ErrorCard message={prendas.error} onRetry={prendas.reload} />
        : prendas.data.length === 0 ? <Vacio>No encontramos prendas{q ? ` para “${q}”` : ""}. Prueba con otra búsqueda o tipo de prenda.</Vacio>
        : (
          <div className="grilla">
            {prendas.data.map((p) => <TarjetaPrenda key={p.id_prenda} prenda={p} />)}
          </div>
        )}
    </>
  );
}
