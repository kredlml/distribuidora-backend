import Modal from "../../components/Modal";
import { useToast } from "../../context/ToastContext";
import useSubmit from "../../hooks/useSubmit";
import * as proveedoresService from "../../services/proveedoresService";
import { soloCambios } from "../../utils/cambios";

/** Alta (sin `proveedor`) o edición de un proveedor. */
export default function ProveedorDialog({ proveedor: p, onClose, onDone }) {
  const aviso = useToast();
  const { error, enviando, onSubmit } = useSubmit(async (fd) => {
    const v = (k) => fd.get(k).trim() || null;
    const body = { nombre_empresa: fd.get("nombre_empresa").trim(), nombre_contacto: v("nombre_contacto"), telefono: v("telefono"), email: v("email"), direccion: v("direccion") };
    if (p) {
      body.activo = fd.get("activo") === "on";
      const cambios = soloCambios(body, { ...p, activo: p.activo !== false });
      if (Object.keys(cambios).length) {
        await proveedoresService.actualizar(p.id_proveedor, cambios);
        aviso(`Proveedor «${body.nombre_empresa}» actualizado.`);
      } else aviso("No hiciste cambios.");
    } else {
      const r = await proveedoresService.crear(body);
      aviso(`Proveedor «${r.nombre_empresa}» registrado.`);
    }
    onDone();
  });

  return (
    <Modal onClose={onClose}>
      <form onSubmit={onSubmit}>
        <h1>{p ? "Editar proveedor" : "Nuevo proveedor"}</h1>
        <label className="sm muted">Empresa<input className="field" name="nombre_empresa" maxLength={120} required defaultValue={p ? p.nombre_empresa : ""} /></label>
        <div className="grid2">
          <label className="sm muted">Contacto (opcional)<input className="field" name="nombre_contacto" maxLength={100} defaultValue={p ? p.nombre_contacto || "" : ""} /></label>
          <label className="sm muted">Teléfono (opcional)<input className="field" name="telefono" type="tel" maxLength={20} defaultValue={p ? p.telefono || "" : ""} /></label>
        </div>
        <label className="sm muted">Correo (opcional)<input className="field" name="email" type="email" maxLength={120} defaultValue={p ? p.email || "" : ""} /></label>
        <label className="sm muted">Dirección (opcional)<input className="field" name="direccion" maxLength={200} defaultValue={p ? p.direccion || "" : ""} /></label>
        {p && <label className="chk"><input type="checkbox" name="activo" defaultChecked={p.activo !== false} /><span>Proveedor activo</span></label>}
        <div className="err" role="alert">{error}</div>
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn pri" disabled={enviando}>{p ? "Guardar cambios" : "Registrar proveedor"}</button>
        </div>
      </form>
    </Modal>
  );
}
