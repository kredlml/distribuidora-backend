import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import useSubmit from "../../hooks/useSubmit";
import "./Cuenta.css";

/** Llega desde el enlace del correo (/restablecer?correo=…&token=…): crea la contraseña nueva. */
export default function Restablecer() {
  const { restablecer } = useAuth();
  const aviso = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  // El token se lee una vez y se quita de la barra de direcciones (no queda en el historial ni
  // viaja como Referer a otros sitios).
  const [datos] = useState(() => {
    const p = new URLSearchParams(location.search);
    return (location.state && location.state.restablecer) || { correo: p.get("correo") || "", token: p.get("token") || "" };
  });
  useEffect(() => {
    if (location.search) navigate("/restablecer", { replace: true, state: { restablecer: datos } });
  }, [location.search, navigate, datos]);

  const { error, enviando, onSubmit } = useSubmit(async (fd) => {
    if (fd.get("password") !== fd.get("password2")) throw new Error("Las contraseñas no coinciden.");
    await restablecer({ email: datos.correo, token: datos.token, password: fd.get("password") });
    aviso("Listo, tu contraseña cambió.");
    navigate("/", { replace: true });
  });

  if (!datos.correo || !datos.token) {
    return (
      <section className="card cuenta-card">
        <h1>Enlace incompleto</h1>
        <p className="muted">Abre el enlace tal como llegó a tu correo, o pide uno nuevo.</p>
        <p className="sm"><Link to="/olvide">Pedir un enlace nuevo</Link></p>
      </section>
    );
  }

  return (
    <section className="card cuenta-card">
      <h1>Crea tu contraseña nueva</h1>
      <p className="muted sm">{datos.correo}</p>
      <form className="stack" onSubmit={onSubmit}>
        <label className="sm muted">Contraseña nueva<input className="field" type="password" name="password" minLength={8} autoComplete="new-password" required /></label>
        <label className="sm muted">Repite la contraseña<input className="field" type="password" name="password2" minLength={8} autoComplete="new-password" required /></label>
        <div className="err" role="alert">{error}</div>
        <button className="btn pri" disabled={enviando}>{enviando ? "Guardando…" : "Guardar contraseña"}</button>
      </form>
      <p className="sm muted">Al guardarla se cerrarán las sesiones abiertas en otros dispositivos.</p>
      {error && <p className="sm"><Link to="/olvide">Pedir un enlace nuevo</Link></p>}
    </section>
  );
}
