import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import useSubmit from "../../hooks/useSubmit";
import "./Cuenta.css";

export default function Login() {
  const { sesion, entrar } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const destino = (location.state && location.state.desde) || "/";

  const { error, enviando, onSubmit } = useSubmit(async (fd) => {
    await entrar(fd.get("email").trim(), fd.get("password"));
    navigate(destino, { replace: true });
  });

  if (sesion && !enviando) return <Navigate to={destino} replace />;

  return (
    <section className="card cuenta-card">
      <h1>Inicia sesión</h1>
      <p className="muted">Para comprar, pagar y seguir tus pedidos.</p>
      <form className="stack" onSubmit={onSubmit}>
        <label className="sm muted">Correo<input className="field" type="email" name="email" autoComplete="username" required /></label>
        <label className="sm muted">Contraseña<input className="field" type="password" name="password" autoComplete="current-password" required /></label>
        <div className="err" role="alert">{error}</div>
        <button className="btn pri" disabled={enviando}>{enviando ? "Entrando…" : "Iniciar sesión"}</button>
      </form>
      <p className="sm">¿No tienes cuenta? <Link to="/registro" state={location.state}>Crea una</Link></p>
      <p className="sm">¿Te registraron en caja? <Link to="/activar" state={location.state}>Activa tu cuenta con tu código</Link></p>
    </section>
  );
}
