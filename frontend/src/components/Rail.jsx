import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { PERMISOS } from "../utils/permisos";
import CambiarPasswordDialog from "./CambiarPasswordDialog";
import Icon from "./Icon";
import "../styles/rail.css";

export default function Rail() {
  const { sesion, rol, salir } = useAuth();
  const { pathname } = useLocation();
  const [cuenta, setCuenta] = useState(false);
  if (!sesion) return null;

  const iniciales = ((sesion.nombre || "?")[0] + ((sesion.apellido || "")[0] || "")).toUpperCase();
  const enlaces = [
    ["/", "Devoluciones", "list", pathname === "/" || pathname.startsWith("/devolucion")],
    ["/nueva", "Nueva solicitud", "plus", pathname === "/nueva"],
    ["/pedidos", "Pedidos", "receipt", pathname.startsWith("/pedidos")],
  ];
  if (PERMISOS.clientes.includes(rol)) enlaces.push(["/clientes", "Clientes", "user", pathname === "/clientes"]);
  enlaces.push(
    ["/trazabilidad", "Trazabilidad", "route", pathname.startsWith("/trazabilidad")],
    ["/inventario", "Inventario", "box", pathname === "/inventario"],
  );
  if (PERMISOS.catalogo.includes(rol)) enlaces.push(["/catalogo", "Catálogo y stock", "tag", pathname === "/catalogo"]);
  if (PERMISOS.sucursales.includes(rol)) enlaces.push(["/sucursales", "Sucursales", "store", pathname === "/sucursales"]);
  if (PERMISOS.proveedores.includes(rol)) enlaces.push(["/proveedores", "Proveedores", "truck", pathname === "/proveedores"]);
  if (PERMISOS.empleados.includes(rol)) enlaces.push(["/empleados", "Empleados", "users", pathname === "/empleados"]);
  if (PERMISOS.reportes.includes(rol)) enlaces.push(["/reportes", "Reportes de ventas", "chart", pathname === "/reportes"]);
  if (PERMISOS.promociones.includes(rol)) enlaces.push(["/promociones", "Promociones", "percent", pathname === "/promociones"]);
  if (PERMISOS.sistema.includes(rol)) enlaces.push(["/sistema", "Estado del sistema", "pulse", pathname === "/sistema"]);

  return (
    <nav id="rail" aria-label="Navegación principal">
      {enlaces.map(([to, t, icon, activo]) => (
        <Link key={to} to={to} className={`nav ${activo ? "on" : ""}`} title={t} aria-label={t}><Icon name={icon} /></Link>
      ))}
      <span className="sp" />
      <button className="avatar" title={`${sesion.nombre} (${sesion.puesto || "sin puesto"}${sesion.sucursal ? `, ${sesion.sucursal}` : rol === "DISTRITAL" ? ", todas las sucursales" : ""}). Mi cuenta y contraseña`} aria-label="Mi cuenta" onClick={() => setCuenta(true)}>{iniciales}</button>
      <button className="nav" title="Cerrar sesión" aria-label="Cerrar sesión" onClick={salir}><Icon name="out" /></button>
      {cuenta && <CambiarPasswordDialog onClose={() => setCuenta(false)} />}
    </nav>
  );
}
