import Modal from "../../components/Modal";
import { useToast } from "../../context/ToastContext";
import useSubmit from "../../hooks/useSubmit";
import * as categoriasService from "../../services/categoriasService";

export default function EditarTipoDialog({ tipo: c, onClose, onDone }) {
  const aviso = useToast();
  const { error, enviando, onSubmit } = useSubmit(async (fd) => {
    await categoriasService.actualizar(c.id_categoria, { nombre: fd.get("nombre").trim(), descripcion: fd.get("descripcion").trim() || null });
    aviso("Tipo de prenda actualizado.");
    onDone();
  });

  return (
    <Modal onClose={onClose}>
      <form onSubmit={onSubmit}>
        <h1>Editar tipo de prenda</h1>
        <label className="sm muted">Nombre<input className="field" name="nombre" maxLength={60} required defaultValue={c.nombre} /></label>
        <label className="sm muted">Descripción (opcional)<input className="field" name="descripcion" maxLength={200} defaultValue={c.descripcion || ""} /></label>
        <div className="err" role="alert">{error}</div>
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn pri" disabled={enviando}>Guardar cambios</button>
        </div>
      </form>
    </Modal>
  );
}
