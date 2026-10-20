import Modal from "../../components/Modal";
import { useToast } from "../../context/ToastContext";
import useSubmit from "../../hooks/useSubmit";
import * as sucursalesService from "../../services/sucursalesService";
import { soloCambios } from "../../utils/cambios";

/** Alta (sin `sucursal`) o edición de una sucursal. */
export default function SucursalDialog({ sucursal: s, onClose, onDone }) {
  const aviso = useToast();
  const { error, enviando, onSubmit } = useSubmit(async (fd) => {
    const body = {
      nombre: fd.get("nombre").trim(), direccion: fd.get("direccion").trim(), ciudad: fd.get("ciudad").trim(),
      telefono: fd.get("telefono").trim() || null,
    };
    if (s) {
      body.activo = fd.get("activo") === "on";
      const cambios = soloCambios(body, { ...s, activo: s.activo !== false });
      if (Object.keys(cambios).length) {
        await sucursalesService.actualizar(s.id_sucursal, cambios);
        aviso(`Sucursal «${body.nombre}» actualizada.`);
      } else aviso("No hiciste cambios.");
    } else {
      const r = await sucursalesService.crear(body);
      aviso(`Sucursal «${r.nombre}» creada.`);
    }
    onDone();
  });

  return (
    <Modal onClose={onClose}>
      <form onSubmit={onSubmit}>
        <h1>{s ? `Editar sucursal #${s.id_sucursal}` : "Nueva sucursal"}</h1>
        <label className="sm muted">Nombre<input className="field" name="nombre" maxLength={100} required defaultValue={s ? s.nombre : ""} /></label>
        <label className="sm muted">Dirección<input className="field" name="direccion" maxLength={200} required defaultValue={s ? s.direccion : ""} /></label>
        <div className="grid2">
          <label className="sm muted">Ciudad<input className="field" name="ciudad" maxLength={80} required defaultValue={s ? s.ciudad : ""} /></label>
          <label className="sm muted">Teléfono (opcional)<input className="field" name="telefono" maxLength={20} defaultValue={s ? s.telefono || "" : ""} /></label>
        </div>
        {s && (
          <label className="chk"><input type="checkbox" name="activo" defaultChecked={s.activo !== false} />
            <span>Sucursal activa<br /><span className="muted sm">Si la desactivas deja de vender en la tienda en línea y no aparece para ingresar stock; conserva su historial.</span></span>
          </label>
        )}
        <div className="err" role="alert">{error}</div>
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn pri" disabled={enviando}>{s ? "Guardar cambios" : "Crear sucursal"}</button>
        </div>
      </form>
    </Modal>
  );
}
