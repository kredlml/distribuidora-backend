import Modal from "../../components/Modal";
import { useToast } from "../../context/ToastContext";
import useSubmit from "../../hooks/useSubmit";
import * as empleadosService from "../../services/empleadosService";
import { nombreEmp } from "../../utils/format";

/** Un ADMIN asigna una contraseña temporal a otro empleado. */
export default function PasswordDialog({ empleado: e, onClose, onDone }) {
  const aviso = useToast();
  const { error, enviando, onSubmit } = useSubmit(async (fd) => {
    if (fd.get("password") !== fd.get("password2")) throw new Error("Las contraseñas no coinciden.");
    const r = await empleadosService.restablecerPassword(e.id_empleado, fd.get("password"));
    aviso(r.message);
    onDone();
  });

  return (
    <Modal onClose={onClose}>
      <form onSubmit={onSubmit}>
        <h1>{e.tiene_acceso ? "Restablecer contraseña" : "Dar acceso al panel"}</h1>
        <p>{nombreEmp(e)}, {e.email || "sin correo"}</p>
        {!e.email && <p className="err">Este empleado no tiene correo: agrégalo desde Editar para que pueda iniciar sesión.</p>}
        <label className="sm muted">Contraseña temporal<input className="field" name="password" type="password" minLength={8} maxLength={72} required autoComplete="new-password" /></label>
        <label className="sm muted">Repite la contraseña<input className="field" name="password2" type="password" minLength={8} maxLength={72} required autoComplete="new-password" /></label>
        <p className="muted sm">Entrégasela en persona y pídele que la cambie al entrar (desde su avatar, abajo a la izquierda). Si tenía una sesión abierta, se cierra.</p>
        <div className="err" role="alert">{error}</div>
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn pri" disabled={enviando || !e.email}>Guardar contraseña</button>
        </div>
      </form>
    </Modal>
  );
}
