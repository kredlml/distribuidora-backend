import { useState } from "react";
import { useToast } from "../../context/ToastContext";
import useSubmit from "../../hooks/useSubmit";
import * as categoriasService from "../../services/categoriasService";
import { vacioANull } from "../../utils/format";
import EditarTipoDialog from "./EditarTipoDialog";
import EliminarTipoDialog from "./EliminarTipoDialog";

export default function TiposTab({ cats, prods, reload, edita }) {
  const aviso = useToast();
  const [editando, setEditando] = useState(null);
  const [eliminando, setEliminando] = useState(null);
  const prendasDe = (id) => prods.filter((p) => p.id_categoria === id).length;

  const { error, enviando, onSubmit } = useSubmit(async (fd, form) => {
    const r = await categoriasService.crear({ nombre: fd.get("nombre").trim(), descripcion: vacioANull(fd.get("descripcion")) });
    aviso(`Tipo «${r.nombre}» creado.`);
    form.reset();
    reload();
  });

  const cerrar = () => { setEditando(null); setEliminando(null); };
  const hecho = () => { cerrar(); reload(); };

  return (
    <>
      {edita && <form className="card stack" onSubmit={onSubmit}>
        <h2>Nuevo tipo de prenda</h2>
        <label className="sm muted">Nombre<input className="field" name="nombre" maxLength={60} required /></label>
        <label className="sm muted">Descripción (opcional)<input className="field" name="descripcion" maxLength={200} /></label>
        <div className="err" role="alert">{error}</div>
        <div><button className="btn pri" disabled={enviando}>Crear tipo de prenda</button></div>
      </form>}
      <section className="card">
        <h2>Tipos registrados ({cats.length})</h2>
        {cats.length ? cats.map((c) => {
          const n = prendasDe(c.id_categoria);
          return (
            <div className="item" key={c.id_categoria}>
              <div>{c.nombre}<br /><span className="muted sm">{c.descripcion || "Sin descripción"}, {n} prenda{n === 1 ? "" : "s"}</span></div>
              {edita && (
                <div className="ctl">
                  <button className="btn mini" onClick={() => setEditando(c)}>Editar</button>
                  <button className="btn mini bad" onClick={() => setEliminando({ ...c, prendas: n })}>Eliminar</button>
                </div>
              )}
            </div>
          );
        }) : <p className="muted">Aún no hay tipos de prenda.</p>}
      </section>

      {editando && <EditarTipoDialog tipo={editando} onClose={cerrar} onDone={hecho} />}
      {eliminando && <EliminarTipoDialog tipo={eliminando} onClose={cerrar} onDone={hecho} />}
    </>
  );
}
