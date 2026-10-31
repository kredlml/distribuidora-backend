import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChipEstado } from "../../components/Chip";
import { Cargando, ErrorCard } from "../../components/Estado";
import { useAuth } from "../../context/AuthContext";
import useFetch from "../../hooks/useFetch";
import * as devolucionesService from "../../services/devolucionesService";
import { ACCION } from "../../utils/constants";
import { fecha, fechaDe, humanizar, nombreCli, nombreEmp, observacion, prod } from "../../utils/format";
import { PERMISOS, accionesDe, puede } from "../../utils/permisos";
import Reembolsos from "../../components/Reembolsos";
import ComprobantesDe from "../../components/ComprobantesDe";
import AccionDialog from "./AccionDialog";

export default function DevolucionDetalle() {
  const { id } = useParams();
  const { rol } = useAuth();
  const navigate = useNavigate();
  const [accion, setAccion] = useState(null);
  const [version, setVersion] = useState(0);

  const { data, error, loading, reload } = useFetch(
    async () => {
      const [d, h] = await Promise.all([devolucionesService.obtener(id), devolucionesService.historial(id)]);
      return { d, h };
    },
    [id],
  );

  const volver = <button className="back" onClick={() => navigate("/")}>Volver al listado</button>;
  if (loading && !data) return <>{volver}<Cargando>Cargando devolución…</Cargando></>;
  if (error) return <>{volver}<ErrorCard message={error} /></>;

  const { d, h } = data;
  const acciones = accionesDe(d);
  const permitidas = acciones.filter((a) => puede(rol, a));

  return (
    <>
      {volver}
      <div className="head"><h1>Devolución #{d.id_devolucion}</h1><ChipEstado estado={d.estado} /></div>
      <section className="card">
        <div className="kv">
          <div><b>Cliente</b>{nombreCli(d)}</div>
          <div><b>Pedido</b><Link to={`/trazabilidad?pedido=${d.id_pedido}`}>{d.id_pedido}, ver trazabilidad</Link></div>
          <div><b>Tipo</b>{humanizar(d.tipo)}</div>
          <div><b>Motivo</b>{humanizar(d.motivo)}</div>
          <div><b>Solicitada</b>{fecha(d.fecha_solicitud)}</div>
          <div><b>Última actualización</b>{fecha(d.fecha_actualizacion)}</div>
          <div><b>Gestionada por</b>{nombreEmp(d.Empleado)}</div>
          <div><b>Observación</b>{d.observacion || "—"}</div>
        </div>
        {permitidas.length ? (
          <div className="bar sec">
            {permitidas.map((a) => (
              <button key={a} className={`btn ${a === "rechazar" ? "bad" : "pri"}`} onClick={() => setAccion(a)}>{ACCION[a].boton}</button>
            ))}
          </div>
        ) : acciones.length ? (
          <p className="muted sm sec">Siguiente paso: {ACCION[acciones[0]].boton.toLowerCase()}. Lo realiza {PERMISOS[acciones[0]].join(" o ")}.</p>
        ) : (
          <p className="muted sm sec">Esta devolución ya está cerrada.</p>
        )}
      </section>

      {["REINTEGRADA", "CAMBIADA"].includes(d.estado) && <div className="sec"><Reembolsos filtro={{ id_devolucion: d.id_devolucion }} version={version} /></div>}
      {["REINTEGRADA", "CAMBIADA"].includes(d.estado) && <div className="sec"><ComprobantesDe filtro={{ id_devolucion: d.id_devolucion }} version={`${d.estado}-${version}`} /></div>}

      <section className="card sec">
        <h2>Prendas</h2>
        {(d.DetalleDevolucions || []).length ? d.DetalleDevolucions.map((x) => (
          <div className="item" key={x.id_detalle_devolucion}>
            <div>
              {prod(x.Producto)}<br />
              <span className="muted sm">{x.cantidad} unidad{x.cantidad === 1 ? "" : "es"}{x.ProductoNuevo ? ", cambia por " + prod(x.ProductoNuevo) : ""}</span>
            </div>
            <span className="muted sm">Inspección: {humanizar(x.resultado_revision)}</span>
          </div>
        )) : <p className="muted">Sin prendas registradas.</p>}
      </section>

      <div className="cols sec">
        <section className="card">
          <h2>Decisiones</h2>
          <ul className="tl">
            {(h.auditoria || []).length ? h.auditoria.map((a, i) => (
              <li key={a.id_auditoria ?? i}>
                <div>{humanizar((a.accion || "").replace(/^DEVOLUCION_/, ""))}</div>
                <div className="muted sm">{nombreEmp(a.Empleado)}, {fechaDe(a)}</div>
                {a.detalles && <div className="sm">{a.detalles}</div>}
              </li>
            )) : <li className="vacio muted">Aún sin decisiones registradas.</li>}
          </ul>
        </section>
        <section className="card">
          <h2>Movimientos de inventario</h2>
          <ul className="tl">
            {(h.movimientos || []).length ? h.movimientos.map((m, i) => (
              <li key={m.id_movimiento ?? i}>
                <div>{humanizar(m.tipo_movimiento)}</div>
                <div className="muted sm">{prod(m.Producto)}, {m.cantidad} u.</div>
                <div className="muted sm">{nombreEmp(m.Empleado)}, {fechaDe(m)}</div>
                {m.observacion && <div className="sm">{observacion(m.observacion)}</div>}
              </li>
            )) : <li className="vacio muted">Sin movimientos.</li>}
          </ul>
        </section>
      </div>

      {accion && (
        <AccionDialog
          accion={accion}
          devolucion={d}
          onClose={() => setAccion(null)}
          onDone={() => { setAccion(null); reload(); setVersion((v) => v + 1); }}
        />
      )}
    </>
  );
}
