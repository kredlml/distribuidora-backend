import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { PERMISOS } from "../utils/permisos";
import Icon from "./Icon";
import "../styles/rail.css";

export default function Rail() {
  const { sesion, rol, salir } = useAuth();
  const { pathname } = useLocation();
  if (!sesion) return null;

  const iniciales = ((sesion.nombre || "?")[0] + ((sesion.apellido || "")[0] || "")).toUpperCase();
  const enlaces = [
    ["/", "Devoluciones", "list", pathname === "/" || pathname.startsWith("/devolucion")],
    ["/nueva", "Nueva solicitud", "plus", pathname === "/nueva"],
    ["/trazabilidad", "Trazabilidad", "route", pathname.startsWith("/trazabilidad")],
    ["/inventario", "Inventario", "box", pathname === "/inventario"],
  ];
  if (PERMISOS.catalogo.includes(rol)) enlaces.push(["/catalogo", "Catálogo y stock", "tag", pathname === "/catalogo"]);

  return (
    <nav id="rail" aria-label="Navegación principal">
      {enlaces.map(([to, t, icon, activo]) => (
        <Link key={to} to={to} className={`nav ${activo ? "on" : ""}`} title={t} aria-label={t}><Icon name={icon} /></Link>
      ))}
      <span className="sp" />
      <div className="avatar" title={`${sesion.nombre} (${sesion.puesto || "sin puesto"})`}>{iniciales}</div>
      <button className="nav" title="Cerrar sesión" aria-label="Cerrar sesión" onClick={salir}><Icon name="out" /></button>
    </nav>
  );
}
