import Modal from "./Modal";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import useSubmit from "../hooks/useSubmit";
import * as authService from "../services/authService";

/** El empleado con sesión cambia su propia contraseña (p.ej. la temporal que le dio un ADMIN). */
export default function CambiarPasswordDialog({ onClose }) {
  const { sesion, renovarToken } = useAuth();
  const aviso = useToast();
  const { error, enviando, onSubmit } = useSubmit(async (fd) => {
    if (fd.get("nueva") !== fd.get("nueva2")) throw new Error("Las contraseñas nuevas no coinciden.");
    const r = await authService.cambiarPassword(fd.get("actual"), fd.get("nueva"));
    if (r.token) renovarToken(r.token); // las demás sesiones se cerraron; esta sigue con el token nuevo
    aviso(r.message || "Contraseña actualizada.");
    onClose();
  });

  return (
    <Modal onClose={onClose}>
      <form onSubmit={onSubmit}>
        <h1>Mi cuenta</h1>
        <p className="muted sm">{sesion.nombre} {sesion.apellido || ""}, {sesion.email} ({sesion.puesto || "sin puesto"})</p>
        <input type="email" name="usuario" value={sesion.email || ""} autoComplete="username" hidden readOnly />
        <label className="sm muted">Contraseña actual<input className="field" name="actual" type="password" required autoComplete="current-password" /></label>
        <label className="sm muted">Nueva contraseña<input className="field" name="nueva" type="password" minLength={8} maxLength={72} required autoComplete="new-password" /></label>
        <label className="sm muted">Repite la nueva contraseña<input className="field" name="nueva2" type="password" minLength={8} maxLength={72} required autoComplete="new-password" /></label>
        <div className="err" role="alert">{error}</div>
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>Cerrar</button>
          <button className="btn pri" disabled={enviando}>Cambiar contraseña</button>
        </div>
      </form>
    </Modal>
  );
}
