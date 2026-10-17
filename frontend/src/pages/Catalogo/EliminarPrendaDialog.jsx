import Modal from "../../components/Modal";
import { useToast } from "../../context/ToastContext";
import useSubmit from "../../hooks/useSubmit";
import * as productosService from "../../services/productosService";
import { prod } from "../../utils/format";

export default function EliminarPrendaDialog({ prenda: p, onClose, onDone }) {
  const aviso = useToast();
  const { error, enviando, onSubmit } = useSubmit(async () => {
    await productosService.eliminar(p.id_producto);
    aviso(`Prenda #${p.id_producto} eliminada.`);
    onDone();
  });

  return (
    <Modal onClose={onClose}>
      <form onSubmit={onSubmit}>
        <h1>Eliminar prenda #{p.id_producto}</h1>
        <p>{prod(p)}</p>
        <p className="muted">Solo se puede eliminar si nunca tuvo variantes, inventario, ventas ni devoluciones. Si ya tiene historial, desactívala desde Editar. Esta acción no se puede deshacer.</p>
        <div className="err" role="alert">{error}</div>
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn bad" disabled={enviando}>Eliminar prenda</button>
        </div>
      </form>
    </Modal>
  );
}
