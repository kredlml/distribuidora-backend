import { Link } from "react-router-dom";
import { fechaDe, humanizar, nombreEmp, observacion, prod } from "../utils/format";

/** Línea de tiempo de movimientos de inventario (trazabilidad). */
export default function Timeline({ movs, conProducto = false }) {
  if (!movs.length) return <ul className="tl"><li className="vacio muted">Sin movimientos registrados.</li></ul>;
  return (
    <ul className="tl">
      {movs.map((m, i) => (
        <li key={m.id_movimiento ?? i}>
          <div>{humanizar(m.tipo_movimiento)}, {m.cantidad} u.</div>
          {conProducto && <div className="muted sm">{prod(m.Producto)}</div>}
          {(m.estado_anterior || m.estado_nuevo) && <div className="muted sm">{humanizar(m.estado_anterior)} a {humanizar(m.estado_nuevo)}</div>}
          <div className="muted sm">
            {nombreEmp(m.Empleado)}, {fechaDe(m)}
            {m.id_devolucion ? <>, <Link to={`/devolucion/${m.id_devolucion}`}>devolución #{m.id_devolucion}</Link></> : null}
          </div>
          {m.observacion && <div className="sm">{observacion(m.observacion)}</div>}
        </li>
      ))}
    </ul>
  );
}
