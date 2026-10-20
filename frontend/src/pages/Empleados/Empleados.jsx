import { useState } from "react";
import { ChipBar } from "../../components/Chip";
import { Cargando, ErrorCard } from "../../components/Estado";
import SearchBox from "../../components/SearchBox";
import { useAuth } from "../../context/AuthContext";
import useFetch from "../../hooks/useFetch";
import * as empleadosService from "../../services/empleadosService";
import * as sucursalesService from "../../services/sucursalesService";
import { PUESTOS } from "../../utils/constants";
import { nombreEmp } from "../../utils/format";
import { rolDe } from "../../utils/permisos";
import EmpleadoDialog from "./EmpleadoDialog";
import PasswordDialog from "./PasswordDialog";

const NOMBRE_PUESTO = Object.fromEntries(PUESTOS);
const FILTROS = [["activos", "Activos"], ["inactivos", "Desactivados"], ["todos", "Todos"]];

export default function Empleados() {
  const { sesion, refrescar } = useAuth();
  const [filtro, setFiltro] = useState("activos");
  const [q, setQ] = useState("");
  const [dialogo, setDialogo] = useState(null); // { tipo: "nuevo" | "editar" | "password", empleado }
  // Si las sucursales no cargan se muestra el error: con la lista vacía, editar a alguien le quitaría su sucursal.
  const { data, error, loading, reload } = useFetch(async () => {
    const [emps, sucs] = await Promise.all([empleadosService.listar(), sucursalesService.listarOFallar()]);
    return { emps, sucs };
  }, []);

  const cerrar = () => setDialogo(null);
  const hecho = () => {
    // Si me edité a mí mismo, el menú y "Mi cuenta" deben mostrar el nombre y correo nuevos.
    if (dialogo && dialogo.empleado && sesion && dialogo.empleado.id_empleado === sesion.id) refrescar();
    cerrar(); reload();
  };

  const texto = q.trim().toLowerCase();
  const lista = (data ? data.emps : [])
    .filter((e) => (filtro === "todos" ? true : filtro === "activos" ? e.activo !== false : e.activo === false))
    .filter((e) => !texto || `${nombreEmp(e)} ${e.email || ""} ${e.puesto || ""}`.toLowerCase().includes(texto));

  return (
    <>
      <div className="head">
        <div><h1>Empleados</h1><div className="muted sm">Cuentas del personal y su puesto. Solo los administradores ven esta sección.</div></div>
        <button className="btn pri" onClick={() => setDialogo({ tipo: "nuevo" })}>Nuevo empleado</button>
      </div>
      <div className="bar">
        <SearchBox label="Buscar" placeholder="Buscar por nombre, correo o puesto" value={q} onChange={(ev) => setQ(ev.target.value)} />
      </div>
      <ChipBar items={FILTROS} value={filtro} onChange={setFiltro} />
      <div className="stack">
        {loading && !data ? <Cargando>Cargando empleados…</Cargando>
          : error ? <ErrorCard message={error} onRetry={reload} />
          : (
            <section className="card">
              <h2>{lista.length} empleado{lista.length === 1 ? "" : "s"}</h2>
              {lista.length ? lista.map((e) => {
                const soyYo = sesion && e.id_empleado === sesion.id;
                return (
                  <div className="item" key={e.id_empleado}>
                    <div>
                      {nombreEmp(e)}{soyYo && <span className="muted"> (tú)</span>} <span className="st">{NOMBRE_PUESTO[rolDe(e)] || e.puesto || "Sin puesto"}</span>
                      {e.activo === false && <> <span className="st bad">Desactivado</span></>}
                      <br />
                      <span className="muted sm">
                        #{e.id_empleado}, {e.email || "sin correo"}, {e.Sucursal ? e.Sucursal.nombre : "sin sucursal"}
                        {!e.tiene_acceso && ", sin contraseña (no puede iniciar sesión)"}
                      </span>
                    </div>
                    <div className="ctl">
                      <button className="btn mini" onClick={() => setDialogo({ tipo: "editar", empleado: e })}>Editar</button>
                      <button className="btn mini" onClick={() => setDialogo({ tipo: "password", empleado: e })}>{e.tiene_acceso ? "Restablecer contraseña" : "Dar acceso"}</button>
                    </div>
                  </div>
                );
              }) : <p className="muted">No hay empleados con estos filtros.</p>}
            </section>
          )}
      </div>

      {dialogo && dialogo.tipo !== "password" && (
        <EmpleadoDialog empleado={dialogo.empleado} sucs={data ? data.sucs : []} soyYo={!!(dialogo.empleado && sesion && dialogo.empleado.id_empleado === sesion.id)} onClose={cerrar} onDone={hecho} />
      )}
      {dialogo && dialogo.tipo === "password" && <PasswordDialog empleado={dialogo.empleado} onClose={cerrar} onDone={hecho} />}
    </>
  );
}
