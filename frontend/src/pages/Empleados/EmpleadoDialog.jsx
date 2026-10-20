import Modal from "../../components/Modal";
import Select from "../../components/Select";
import { useToast } from "../../context/ToastContext";
import useSubmit from "../../hooks/useSubmit";
import * as empleadosService from "../../services/empleadosService";
import { soloCambios } from "../../utils/cambios";
import { PUESTOS } from "../../utils/constants";
import { rolDe } from "../../utils/permisos";

/** Alta (sin `empleado`, con contraseña inicial) o edición de un empleado. */
export default function EmpleadoDialog({ empleado: e, sucs, soyYo, onClose, onDone }) {
  const aviso = useToast();
  const { error, enviando, onSubmit } = useSubmit(async (fd) => {
    const body = {
      nombre: fd.get("nombre").trim(), apellido: fd.get("apellido").trim(), email: fd.get("email").trim(),
      id_sucursal: fd.get("id_sucursal") ? Number(fd.get("id_sucursal")) : null,
    };
    if (!soyYo) body.puesto = fd.get("puesto");
    if (e) {
      if (!soyYo) body.activo = fd.get("activo") === "on";
      // Solo lo que cambió: un diálogo abierto hace rato no reactiva ni cambia el puesto por accidente.
      const cambios = soloCambios(body, { ...e, email: e.email || "", puesto: rolDe(e), activo: e.activo !== false });
      if (!Object.keys(cambios).length) { aviso("No hiciste cambios."); return onDone(); }
      await empleadosService.actualizar(e.id_empleado, cambios);
      aviso(`Datos de ${body.nombre} actualizados.`);
    } else {
      if (fd.get("password") !== fd.get("password2")) throw new Error("Las contraseñas no coinciden.");
      await empleadosService.registrar({ ...body, password: fd.get("password") });
      aviso(`Empleado ${body.nombre} registrado. Ya puede iniciar sesión con su correo.`);
    }
    onDone();
  });

  return (
    <Modal onClose={onClose}>
      <form onSubmit={onSubmit}>
        <h1>{e ? `Editar empleado #${e.id_empleado}` : "Nuevo empleado"}</h1>
        <div className="grid2">
          <label className="sm muted">Nombre<input className="field" name="nombre" maxLength={80} required defaultValue={e ? e.nombre || "" : ""} /></label>
          <label className="sm muted">Apellido<input className="field" name="apellido" maxLength={80} defaultValue={e ? e.apellido || "" : ""} /></label>
        </div>
        <label className="sm muted">Correo (con él inicia sesión)<input className="field" name="email" type="email" maxLength={120} required autoComplete="off" defaultValue={e ? e.email || "" : ""} /></label>
        <div className="grid2">
          <label className="sm muted">Puesto
            <Select className="field" name="puesto" required disabled={soyYo} placeholder="Elige el puesto" defaultValue={e ? rolDe(e) : ""} options={PUESTOS} />
          </label>
          <label className="sm muted">Sucursal
            <Select className="field" name="id_sucursal" placeholder="Sin sucursal" defaultValue={e && e.id_sucursal ? e.id_sucursal : ""}
              options={sucs.filter((s) => s.activo !== false || (e && s.id_sucursal === e.id_sucursal)).map((s) => [s.id_sucursal, s.nombre])} />
          </label>
        </div>
        <p className="muted sm">Administrador: todo el panel. Cajero: ventas y nuevas solicitudes. Bodeguero: catálogo, stock y recepción de devoluciones.</p>
        {!e && (
          <div className="grid2">
            <label className="sm muted">Contraseña inicial<input className="field" name="password" type="password" minLength={8} maxLength={72} required autoComplete="new-password" /></label>
            <label className="sm muted">Repite la contraseña<input className="field" name="password2" type="password" minLength={8} maxLength={72} required autoComplete="new-password" /></label>
          </div>
        )}
        {!e && <p className="muted sm">Mínimo 8 caracteres. Entrégasela en persona; el empleado puede cambiarla desde su avatar al entrar.</p>}
        {e && (
          <label className="chk"><input type="checkbox" name="activo" defaultChecked={e.activo !== false} disabled={soyYo} />
            <span>Cuenta activa<br /><span className="muted sm">Desactivada no puede iniciar sesión y su sesión abierta deja de funcionar. Su historial se conserva.</span></span>
          </label>
        )}
        {soyYo && <p className="muted sm">No puedes cambiar tu propio puesto ni desactivarte; pídeselo a otro administrador.</p>}
        <div className="err" role="alert">{error}</div>
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn pri" disabled={enviando}>{e ? "Guardar cambios" : "Registrar empleado"}</button>
        </div>
      </form>
    </Modal>
  );
}
