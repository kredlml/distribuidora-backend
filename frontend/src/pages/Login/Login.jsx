import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import "./Login.css";

export default function Login() {
  const { sesion, entrar } = useAuth();
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  if (sesion) return <Navigate to="/" replace />;

  const onSubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    setEnviando(true); setError("");
    try {
      await entrar(fd.get("email"), fd.get("password"));
    } catch (e) {
      setError(e.message); setEnviando(false);
    }
  };

  return (
    <main id="app">
      <section className="card login">
        <div className="mark">devoluciones<i>.</i></div>
        <p className="muted">Inicia sesión para gestionar devoluciones y cambios.</p>
        <form onSubmit={onSubmit}>
          <input className="field" type="email" name="email" placeholder="Correo" autoComplete="username" required />
          <input className="field" type="password" name="password" placeholder="Contraseña" autoComplete="current-password" required />
          <div className="err" role="alert">{error}</div>
          <button className="btn pri" disabled={enviando}>Iniciar sesión</button>
        </form>
        <p className="muted sm">¿No tienes cuenta o la olvidaste? Pide a un administrador que te registre o te asigne una contraseña temporal.</p>
      </section>
    </main>
  );
}
