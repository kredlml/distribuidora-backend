import { useAuth } from "../context/AuthContext";

/** Muestra `children` solo si el rol está permitido; si no, el mensaje indicado. */
export default function RoleRoute({ roles, mensaje, children }) {
  const { rol } = useAuth();
  return roles.includes(rol) ? children : <div className="card err">{mensaje}</div>;
}
