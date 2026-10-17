import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Rail from "./Rail";

/** Layout de las pantallas privadas: barra lateral + contenido. Sin sesión redirige al login. */
export default function AppLayout() {
  const { sesion } = useAuth();
  if (!sesion) return <Navigate to="/login" replace />;
  return (
    <div id="shell">
      <Rail />
      <main id="app"><Outlet /></main>
    </div>
  );
}
