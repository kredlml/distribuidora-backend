import { useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import useSubmit from "../../hooks/useSubmit";
import * as authService from "../../services/authService";
import "./Cuenta.css";

/** ¿Olvidaste tu contraseña? Envía al correo un enlace de un solo uso para crear una nueva. */
export default function Olvide() {
  const { sesion } = useAuth();
  const location = useLocation();
  const [enviado, setEnviado] = useState("");

  const { error, enviando, onSubmit } = useSubmit(async (fd) => {
    const r = await authService.olvide(fd.get("email").trim());
    setEnviado(r.message);
  });

  if (sesion) return <Navigate to="/perfil" replace />;

  return (
    <section className="card cuenta-card">
      <h1>¿Olvidaste tu contraseña?</h1>
      {enviado ? (
        <>
          <p>{enviado}</p>
          <p className="sm"><Link to="/login" state={location.state}>Volver a iniciar sesión</Link></p>
        </>
      ) : (
        <>
          <p className="muted">Escribe el correo de tu cuenta y te enviaremos un enlace para crear una contraseña nueva. Si compraste en tienda y nunca creaste una, también te sirve.</p>
          <form className="stack" onSubmit={onSubmit}>
            <label className="sm muted">Correo<input className="field" type="email" name="email" autoComplete="username" required /></label>
            <div className="err" role="alert">{error}</div>
            <button className="btn pri" disabled={enviando}>{enviando ? "Enviando…" : "Enviarme el enlace"}</button>
          </form>
          <p className="sm"><Link to="/login" state={location.state}>Volver a iniciar sesión</Link></p>
        </>
      )}
    </section>
  );
}
