import { useToast } from "../../context/ToastContext";
import useSubmit from "../../hooks/useSubmit";
import * as categoriasService from "../../services/categoriasService";
import { vacioANull } from "../../utils/format";

export default function TiposTab({ cats, reload }) {
  const aviso = useToast();
  const { error, enviando, onSubmit } = useSubmit(async (fd, form) => {
    const r = await categoriasService.crear({ nombre: fd.get("nombre").trim(), descripcion: vacioANull(fd.get("descripcion")) });
    aviso(`Tipo «${r.nombre}» creado.`);
    form.reset();
    reload();
  });

  return (
    <>
      <form className="card stack" onSubmit={onSubmit}>
        <h2>Nuevo tipo de prenda</h2>
        <label className="sm muted">Nombre<input className="field" name="nombre" maxLength={60} required /></label>
        <label className="sm muted">Descripción (opcional)<input className="field" name="descripcion" maxLength={200} /></label>
        <div className="err" role="alert">{error}</div>
        <div><button className="btn pri" disabled={enviando}>Crear tipo de prenda</button></div>
      </form>
      <section className="card">
        <h2>Tipos registrados ({cats.length})</h2>
        {cats.length ? cats.map((c) => (
          <div className="item" key={c.id_categoria}>
            <div>{c.nombre}<br /><span className="muted sm">{c.descripcion || "Sin descripción"}</span></div>
          </div>
        )) : <p className="muted">Aún no hay tipos de prenda.</p>}
      </section>
    </>
  );
}
