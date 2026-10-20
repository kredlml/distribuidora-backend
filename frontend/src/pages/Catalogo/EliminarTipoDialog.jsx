import Modal from "../../components/Modal";
import { useToast } from "../../context/ToastContext";
import useSubmit from "../../hooks/useSubmit";
import * as categoriasService from "../../services/categoriasService";

export default function EliminarTipoDialog({ tipo: c, onClose, onDone }) {
  const aviso = useToast();
  const { error, enviando, onSubmit } = useSubmit(async () => {
    await categoriasService.eliminar(c.id_categoria);
    aviso(`Tipo «${c.nombre}» eliminado.`);
    onDone();
  });
  const enUso = c.prendas > 0;

  return (
    <Modal onClose={onClose}>
      <form onSubmit={onSubmit}>
        <h1>Eliminar tipo de prenda</h1>
        <p>{c.nombre}</p>
        <p className="muted">
          {enUso
            ? `Lo usan ${c.prendas} prenda${c.prendas === 1 ? "" : "s"}. Para eliminarlo, primero cámbialas a otro tipo desde la pestaña Nueva prenda > Editar.`
            : "Ninguna prenda usa este tipo. Esta acción no se puede deshacer."}
        </p>
        <div className="err" role="alert">{error}</div>
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>{enUso ? "Entendido" : "Cancelar"}</button>
          {!enUso && <button className="btn bad" disabled={enviando}>Eliminar tipo</button>}
        </div>
      </form>
    </Modal>
  );
}
