import { useState } from "react";
import Select from "../../components/Select";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import useSubmit from "../../hooks/useSubmit";
import * as productosService from "../../services/productosService";
import { prod, vacioANull } from "../../utils/format";
import EditarPrendaDialog from "./EditarPrendaDialog";
import EliminarPrendaDialog from "./EliminarPrendaDialog";

export default function PrendasTab({ cats, prods, reload }) {
  const { rol } = useAuth();
  const aviso = useToast();
  const [editando, setEditando] = useState(null);
  const [eliminando, setEliminando] = useState(null);
  const bases = prods.filter((p) => !p.id_producto_padre);
  const nombreCat = (id) => (cats.find((c) => c.id_categoria === id) || {}).nombre || "Sin tipo";

  const { error, enviando, onSubmit } = useSubmit(async (fd, form) => {
    const r = await productosService.crear({
      nombre: fd.get("nombre").trim(), id_categoria: Number(fd.get("id_categoria")),
      talla: vacioANull(fd.get("talla")), color: vacioANull(fd.get("color")), descripcion: vacioANull(fd.get("descripcion")),
      precio_unitario: Number(fd.get("precio_unitario")),
      stock_minimo: vacioANull(fd.get("stock_minimo")) === undefined ? undefined : Number(fd.get("stock_minimo")),
      id_producto_padre: fd.get("id_producto_padre") ? Number(fd.get("id_producto_padre")) : undefined,
      imagen_url: vacioANull(fd.get("imagen_url")),
    });
    aviso(`Prenda #${r.id_producto} registrada.`);
    form.reset();
    reload();
  });

  const cerrar = () => { setEditando(null); setEliminando(null); };
  const hecho = () => { cerrar(); reload(); };

  return (
    <>
      <form className="card stack" onSubmit={onSubmit}>
        <h2>Nueva prenda</h2>
        <label className="sm muted">Nombre<input className="field" name="nombre" maxLength={120} required /></label>
        <label className="sm muted">Tipo de prenda
          <Select className="field" name="id_categoria" required placeholder={cats.length ? "Elige el tipo" : "Primero crea un tipo de prenda"}
            options={cats.map((c) => [c.id_categoria, c.nombre])} />
        </label>
        <div className="grid2">
          <label className="sm muted">Talla<input className="field" name="talla" maxLength={10} /></label>
          <label className="sm muted">Color<input className="field" name="color" maxLength={40} /></label>
        </div>
        <div className="grid2">
          <label className="sm muted">Precio de venta<input className="field" name="precio_unitario" type="number" step="0.01" min="0.01" required /></label>
          <label className="sm muted">Stock mínimo (alerta de stock crítico)<input className="field" name="stock_minimo" type="number" step="1" defaultValue={5} /></label>
        </div>
        <label className="sm muted">Variante de
          <Select className="field" name="id_producto_padre" placeholder="Ninguna, es una prenda base" options={bases.map((p) => [p.id_producto, `#${p.id_producto} ${prod(p)}`])} />
        </label>
        <label className="sm muted">Descripción (opcional)<textarea className="field" name="descripcion" maxLength={255} /></label>
        <label className="sm muted">URL de la imagen (opcional, se muestra en la tienda en línea)<input className="field" name="imagen_url" type="url" maxLength={500} placeholder="https://..." /></label>
        <div className="err" role="alert">{error}</div>
        <div><button className="btn pri" disabled={enviando}>Registrar prenda</button></div>
      </form>

      <section className="card">
        <h2>Prendas registradas ({prods.length})</h2>
        {[...prods].sort((a, b) => b.id_producto - a.id_producto).map((p) => (
          <div className="item" key={p.id_producto}>
            <div>
              {prod(p)}<br />
              <span className="muted sm">#{p.id_producto}, {nombreCat(p.id_categoria)}{p.id_producto_padre ? ", variante de #" + p.id_producto_padre : ""}{p.activo ? "" : ", inactiva"}</span>
            </div>
            <div className="ctl">
              <span>{Number(p.precio_unitario).toFixed(2)}</span>
              <button className="btn mini" onClick={() => setEditando(p)}>Editar</button>
              {rol === "ADMIN" && <button className="btn mini bad" onClick={() => setEliminando(p)}>Eliminar</button>}
            </div>
          </div>
        ))}
      </section>

      {editando && <EditarPrendaDialog prenda={editando} cats={cats} prods={prods} onClose={cerrar} onDone={hecho} />}
      {eliminando && <EliminarPrendaDialog prenda={eliminando} onClose={cerrar} onDone={hecho} />}
    </>
  );
}
