import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import useSubmit from "../../hooks/useSubmit";
import "./Cuenta.css";

/** Cliente que ya compró en una tienda física: activa su cuenta web con el código que le dio caja. */
export default function Activar() {
  const { sesion, activar } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const destino = (location.state && location.state.desde) || "/";

  const { error, enviando, onSubmit } = useSubmit(async (fd) => {
    if (fd.get("password") !== fd.get("password2")) throw new Error("Las contraseñas no coinciden.");
    await activar({ email: fd.get("email").trim(), codigo: fd.get("codigo").trim(), password: fd.get("password") });
    navigate(destino, { replace: true });
  });

  if (sesion && !enviando) return <Navigate to={destino} replace />;

  return (
    <section className="card cuenta-card">
      <h1>Activa tu cuenta</h1>
      <p className="muted">¿Ya compraste en una de nuestras tiendas? Pide en caja tu código de activación y crea aquí tu contraseña. Verás también tus compras anteriores.</p>
      <form className="stack" onSubmit={onSubmit}>
        <label className="sm muted">Correo registrado en caja<input className="field" type="email" name="email" autoComplete="username" required /></label>
        <label className="sm muted">Código de activación<input className="field" name="codigo" placeholder="XXXX-XXXX" autoComplete="one-time-code" maxLength={12} required /></label>
        <label className="sm muted">Crea tu contraseña<input className="field" type="password" name="password" minLength={8} autoComplete="new-password" required /></label>
        <label className="sm muted">Repite la contraseña<input className="field" type="password" name="password2" minLength={8} autoComplete="new-password" required /></label>
        <div className="err" role="alert">{error}</div>
        <button className="btn pri" disabled={enviando}>{enviando ? "Activando…" : "Activar cuenta"}</button>
      </form>
      <p className="sm">¿Nunca compraste en tienda? <Link to="/registro" state={location.state}>Crea una cuenta nueva</Link></p>
    </section>
  );
}
