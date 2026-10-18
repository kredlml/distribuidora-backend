import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

/** Pantallas que requieren cuenta: sin sesión manda al login y luego regresa aquí. */
export default function RutaPrivada({ children }) {
  const { sesion, fueCierreVoluntario } = useAuth();
  const location = useLocation();
  if (!sesion) {
    // Si el cliente acaba de cerrar sesión, se va al catálogo (no a pedirle que vuelva a entrar).
    if (fueCierreVoluntario()) return <Navigate to="/" replace />;
    return <Navigate to="/login" replace state={{ desde: location.pathname }} />;
  }
  return children;
}
