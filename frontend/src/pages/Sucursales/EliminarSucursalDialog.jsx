import Modal from "../../components/Modal";
import { useToast } from "../../context/ToastContext";
import useSubmit from "../../hooks/useSubmit";
import * as sucursalesService from "../../services/sucursalesService";

export default function EliminarSucursalDialog({ sucursal: s, onClose, onDone }) {
  const aviso = useToast();
  const { error, enviando, onSubmit } = useSubmit(async () => {
    await sucursalesService.eliminar(s.id_sucursal);
    aviso(`Sucursal «${s.nombre}» eliminada.`);
    onDone();
  });

  return (
    <Modal onClose={onClose}>
      <form onSubmit={onSubmit}>
        <h1>Eliminar sucursal #{s.id_sucursal}</h1>
        <p>{s.nombre}, {s.ciudad}</p>
        <p className="muted">Solo se puede eliminar si nunca tuvo empleados, inventario ni pedidos. Si ya tiene historial, desactívala desde Editar. Esta acción no se puede deshacer.</p>
        <div className="err" role="alert">{error}</div>
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn bad" disabled={enviando}>Eliminar sucursal</button>
        </div>
      </form>
    </Modal>
  );
}
