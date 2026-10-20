import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Cargando, ErrorCard } from "../../components/Estado";
import { useAuth } from "../../context/AuthContext";
import useFetch from "../../hooks/useFetch";
import * as sucursalesService from "../../services/sucursalesService";
import { puede } from "../../utils/permisos";
import EliminarSucursalDialog from "./EliminarSucursalDialog";
import StockSucursal from "./StockSucursal";
import SucursalDialog from "./SucursalDialog";
import "./Sucursales.css";

export default function Sucursales() {
  const { rol } = useAuth();
  const gestiona = puede(rol, "gestionarSucursales");
  const [params, setParams] = useSearchParams();
  const [dialogo, setDialogo] = useState(null); // { tipo: "nueva" | "editar" | "eliminar", sucursal }
  const { data: sucs, error, loading, reload } = useFetch(() => sucursalesService.listarOFallar(), []);

  const elegida = (sucs || []).find((s) => String(s.id_sucursal) === params.get("id"));
  const cerrar = () => setDialogo(null);
  const hecho = (eliminada) => {
    cerrar();
    if (eliminada && elegida && eliminada === elegida.id_sucursal) setParams({});
    reload();
  };

  return (
    <>
      <div className="head">
        <div><h1>Sucursales</h1><div className="muted sm">Datos de cada sucursal y su stock. Para ingresar unidades usa Catálogo y stock.</div></div>
        {gestiona && <button className="btn pri" onClick={() => setDialogo({ tipo: "nueva" })}>Nueva sucursal</button>}
      </div>

      <div className="stack">
        {loading && !sucs ? <Cargando>Cargando sucursales…</Cargando>
          : error ? <ErrorCard message={error} onRetry={reload} />
          : (
            <section className="card">
              <h2>Sucursales registradas ({sucs.length})</h2>
              {sucs.length ? sucs.map((s) => {
                const on = elegida && elegida.id_sucursal === s.id_sucursal;
                return (
                  <div className={`item suc ${on ? "on" : ""}`} key={s.id_sucursal}>
                    <div>
                      {s.nombre} {s.activo === false && <span className="st bad">Inactiva</span>}<br />
                      <span className="muted sm">#{s.id_sucursal}, {s.direccion}, {s.ciudad}{s.telefono ? `, tel. ${s.telefono}` : ""}</span>
                    </div>
                    <div className="ctl">
                      <button className={`btn mini ${on ? "pri" : ""}`} onClick={() => setParams(on ? {} : { id: s.id_sucursal })}>{on ? "Ocultar stock" : "Ver stock"}</button>
                      {gestiona && <button className="btn mini" onClick={() => setDialogo({ tipo: "editar", sucursal: s })}>Editar</button>}
                      {gestiona && <button className="btn mini bad" onClick={() => setDialogo({ tipo: "eliminar", sucursal: s })}>Eliminar</button>}
                    </div>
                  </div>
                );
              }) : <p className="muted">Aún no hay sucursales.{gestiona ? " Crea la primera con «Nueva sucursal»." : ""}</p>}
            </section>
          )}

        {elegida && <StockSucursal key={elegida.id_sucursal} sucursal={elegida} />}
      </div>

      {dialogo && dialogo.tipo !== "eliminar" && <SucursalDialog sucursal={dialogo.sucursal} onClose={cerrar} onDone={() => hecho()} />}
      {dialogo && dialogo.tipo === "eliminar" && <EliminarSucursalDialog sucursal={dialogo.sucursal} onClose={cerrar} onDone={() => hecho(dialogo.sucursal.id_sucursal)} />}
    </>
  );
}
