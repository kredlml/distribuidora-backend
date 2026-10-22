import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import useSubmit from "../../hooks/useSubmit";
import "./Cuenta.css";

export default function Registro() {
  const { sesion, registrar } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const destino = (location.state && location.state.desde) || "/";

  const { error, enviando, onSubmit } = useSubmit(async (fd) => {
    if (fd.get("password") !== fd.get("password2")) throw new Error("Las contraseñas no coinciden.");
    await registrar({
      nombre: fd.get("nombre").trim(), apellido: fd.get("apellido").trim(), email: fd.get("email").trim(),
      password: fd.get("password"), telefono: fd.get("telefono").trim(), direccion: fd.get("direccion").trim(),
    });
    navigate(destino, { replace: true });
  });

  if (sesion && !enviando) return <Navigate to={destino} replace />;

  return (
    <section className="card cuenta-card">
      <h1>Crea tu cuenta</h1>
      <form className="stack" onSubmit={onSubmit}>
        <div className="grid2">
          <label className="sm muted">Nombre<input className="field" name="nombre" autoComplete="given-name" maxLength={80} required /></label>
          <label className="sm muted">Apellido<input className="field" name="apellido" autoComplete="family-name" maxLength={80} required /></label>
        </div>
        <label className="sm muted">Correo<input className="field" type="email" name="email" autoComplete="email" maxLength={120} required /></label>
        <div className="grid2">
          <label className="sm muted">Contraseña (mínimo 8)<input className="field" type="password" name="password" autoComplete="new-password" minLength={8} required /></label>
          <label className="sm muted">Repite la contraseña<input className="field" type="password" name="password2" autoComplete="new-password" minLength={8} required /></label>
        </div>
        <label className="sm muted">Teléfono (opcional)<input className="field" type="tel" name="telefono" autoComplete="tel" maxLength={20} /></label>
        <label className="sm muted">Dirección de entrega (opcional)<textarea className="field" name="direccion" autoComplete="street-address" maxLength={200} /></label>
        <div className="err" role="alert">
          {error}
          {/caja/.test(error) && <> <Link to="/activar" state={location.state}>Activar mi cuenta</Link></>}
        </div>
        <button className="btn pri" disabled={enviando}>{enviando ? "Creando cuenta…" : "Crear cuenta"}</button>
      </form>
      <p className="sm">¿Ya tienes cuenta? <Link to="/login" state={location.state}>Inicia sesión</Link></p>
      <p className="sm">¿Te registraron en caja? <Link to="/activar" state={location.state}>Activa tu cuenta con tu código</Link></p>
    </section>
  );
}
