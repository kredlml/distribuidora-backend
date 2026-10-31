import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import useSubmit from "../../hooks/useSubmit";
import * as authService from "../../services/authService";
import "./Cuenta.css";

export default function Perfil() {
  const { cliente, actualizarCliente } = useAuth();
  const aviso = useToast();

  const { error, enviando, onSubmit } = useSubmit(async (fd) => {
    const c = await authService.actualizarPerfil({
      nombre: fd.get("nombre").trim(), apellido: fd.get("apellido").trim(),
      telefono: fd.get("telefono").trim(), direccion: fd.get("direccion").trim(),
    });
    actualizarCliente(c);
    aviso("Perfil actualizado.");
  });

  return (
    <section className="card cuenta-card">
      <h1>Mi perfil</h1>
      <p className="muted sm">{cliente.email}</p>
      <form className="stack" onSubmit={onSubmit}>
        <div className="grid2">
          <label className="sm muted">Nombre<input className="field" name="nombre" maxLength={80} required defaultValue={cliente.nombre} /></label>
          <label className="sm muted">Apellido<input className="field" name="apellido" maxLength={80} required defaultValue={cliente.apellido} /></label>
        </div>
        <label className="sm muted">Teléfono<input className="field" type="tel" name="telefono" maxLength={20} defaultValue={cliente.telefono || ""} /></label>
        <label className="sm muted">Dirección de entrega habitual<textarea className="field" name="direccion" maxLength={200} defaultValue={cliente.direccion || ""} /></label>
        <div className="err" role="alert">{error}</div>
        <div><button className="btn pri" disabled={enviando}>Guardar cambios</button></div>
      </form>
      <CambiarPassword />
    </section>
  );
}

function CambiarPassword() {
  const { renovarToken } = useAuth();
  const aviso = useToast();
  const { error, enviando, onSubmit } = useSubmit(async (fd, form) => {
    if (fd.get("nueva") !== fd.get("nueva2")) throw new Error("Las contraseñas nuevas no coinciden.");
    const r = await authService.cambiarPassword(fd.get("actual"), fd.get("nueva"));
    renovarToken(r.token);
    form.reset();
    aviso(r.message);
  });
  return (
    <form className="stack sec" onSubmit={onSubmit}>
      <h2>Cambiar contraseña</h2>
      <label className="sm muted">Contraseña actual<input className="field" type="password" name="actual" autoComplete="current-password" required /></label>
      <div className="grid2">
        <label className="sm muted">Nueva<input className="field" type="password" name="nueva" minLength={8} autoComplete="new-password" required /></label>
        <label className="sm muted">Repite la nueva<input className="field" type="password" name="nueva2" minLength={8} autoComplete="new-password" required /></label>
      </div>
      <div className="err" role="alert">{error}</div>
      <div><button className="btn" disabled={enviando}>{enviando ? "Guardando…" : "Cambiar contraseña"}</button></div>
    </form>
  );
}
