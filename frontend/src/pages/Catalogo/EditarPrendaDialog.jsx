import { useState } from "react";
import FotoPrenda from "../../components/FotoPrenda";
import Modal from "../../components/Modal";
import Select from "../../components/Select";
import { useToast } from "../../context/ToastContext";
import useSubmit from "../../hooks/useSubmit";
import * as productosService from "../../services/productosService";
import { prod, vacioANull } from "../../utils/format";

export default function EditarPrendaDialog({ prenda: p, cats, prods, onClose, onDone }) {
  const aviso = useToast();
  const bases = prods.filter((x) => !x.id_producto_padre && x.id_producto !== p.id_producto);
  const tieneVar = prods.some((x) => x.id_producto_padre === p.id_producto);
  const [foto, setFoto] = useState(p.imagen_url || "");

  const { error, enviando, onSubmit } = useSubmit(async (fd) => {
    const body = {
      nombre: fd.get("nombre").trim(), id_categoria: Number(fd.get("id_categoria")),
      talla: vacioANull(fd.get("talla")) ?? null, color: vacioANull(fd.get("color")) ?? null, descripcion: vacioANull(fd.get("descripcion")) ?? null,
      precio_unitario: Number(fd.get("precio_unitario")), stock_minimo: Number(fd.get("stock_minimo")), activo: fd.get("activo") === "on",
      imagen_url: vacioANull(fd.get("imagen_url")) ?? null,
    };
    if (!tieneVar) body.id_producto_padre = fd.get("id_producto_padre") ? Number(fd.get("id_producto_padre")) : null;
    await productosService.actualizar(p.id_producto, body);
    aviso(`Prenda #${p.id_producto} actualizada.`);
    onDone();
  });

  return (
    <Modal onClose={onClose}>
      <form onSubmit={onSubmit}>
        <h1>Editar prenda #{p.id_producto}</h1>
        <label className="sm muted">Nombre<input className="field" name="nombre" maxLength={120} required defaultValue={p.nombre} /></label>
        <label className="sm muted">Tipo de prenda
          <Select className="field" name="id_categoria" required placeholder="Elige el tipo" defaultValue={p.id_categoria ?? ""} options={cats.map((c) => [c.id_categoria, c.nombre])} />
        </label>
        <div className="grid2">
          <label className="sm muted">Talla<input className="field" name="talla" maxLength={10} defaultValue={p.talla || ""} /></label>
          <label className="sm muted">Color<input className="field" name="color" maxLength={40} defaultValue={p.color || ""} /></label>
        </div>
        <div className="grid2">
          <label className="sm muted">Precio de venta<input className="field" name="precio_unitario" type="number" step="0.01" min="0.01" required defaultValue={Number(p.precio_unitario).toFixed(2)} /></label>
          <label className="sm muted">Stock mínimo<input className="field" name="stock_minimo" type="number" step="1" min="0" required defaultValue={p.stock_minimo ?? 5} /></label>
        </div>
        <label className="sm muted">Variante de
          <Select className="field" name="id_producto_padre" disabled={tieneVar} placeholder="Ninguna, es una prenda base" defaultValue={p.id_producto_padre || ""}
            options={bases.map((x) => [x.id_producto, `#${x.id_producto} ${prod(x)}`])} />
        </label>
        {tieneVar && <div className="muted sm">Esta prenda tiene variantes, por eso no puede ser variante de otra.</div>}
        <label className="sm muted">Descripción<textarea className="field" name="descripcion" maxLength={255} defaultValue={p.descripcion || ""} /></label>
        <FotoPrenda value={foto} onChange={setFoto} />
        {p.id_producto_padre && !foto && <p className="muted sm">Sin foto propia, la tienda muestra la de la prenda base.</p>}
        <label className="chk"><input type="checkbox" name="activo" defaultChecked={!!p.activo} /><span>Prenda activa (se puede vender y usar en cambios)</span></label>
        <div className="err" role="alert">{error}</div>
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn pri" disabled={enviando}>Guardar cambios</button>
        </div>
      </form>
    </Modal>
  );
}
