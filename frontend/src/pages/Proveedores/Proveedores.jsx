import { useState } from "react";
import { ChipBar } from "../../components/Chip";
import { Cargando, ErrorCard } from "../../components/Estado";
import SearchBox from "../../components/SearchBox";
import { useAuth } from "../../context/AuthContext";
import useFetch from "../../hooks/useFetch";
import * as proveedoresService from "../../services/proveedoresService";
import { puede } from "../../utils/permisos";
import ConfirmarDialog from "../PedidoDetalle/ConfirmarDialog";
import ProveedorDialog from "./ProveedorDialog";
import { useToast } from "../../context/ToastContext";

const FILTROS = [["activos", "Activos"], ["inactivos", "Desactivados"], ["todos", "Todos"]];

export default function Proveedores() {
  const { rol } = useAuth();
  const aviso = useToast();
  const [filtro, setFiltro] = useState("activos");
  const [q, setQ] = useState("");
  const [dialogo, setDialogo] = useState(null); // { tipo: "nuevo" | "editar" | "eliminar", proveedor }
  const { data, error, loading, reload } = useFetch(() => proveedoresService.listar(), []);

  const texto = q.trim().toLowerCase();
  const lista = (data || [])
    .filter((p) => (filtro === "todos" ? true : filtro === "activos" ? p.activo !== false : p.activo === false))
    .filter((p) => !texto || `${p.nombre_empresa} ${p.nombre_contacto || ""} ${p.email || ""} ${p.telefono || ""}`.toLowerCase().includes(texto));
  const cerrar = () => setDialogo(null);
  const hecho = () => { cerrar(); reload(); };

  return (
    <>
      <div className="head">
        <div><h1>Proveedores</h1><div className="muted sm">Empresas que surten las prendas y sus contactos.</div></div>
        <button className="btn pri" onClick={() => setDialogo({ tipo: "nuevo" })}>Nuevo proveedor</button>
      </div>
      <div className="bar"><SearchBox label="Buscar" placeholder="Buscar por empresa, contacto, correo o teléfono" value={q} onChange={(ev) => setQ(ev.target.value)} /></div>
      <ChipBar items={FILTROS} value={filtro} onChange={setFiltro} />
      <div className="stack">
        {loading && !data ? <Cargando>Cargando proveedores…</Cargando>
          : error ? <ErrorCard message={error} onRetry={reload} />
          : (
            <section className="card">
              <h2>{lista.length} proveedor{lista.length === 1 ? "" : "es"}</h2>
              {lista.length ? lista.map((p) => (
                <div className="item" key={p.id_proveedor}>
                  <div>
                    {p.nombre_empresa} {p.activo === false && <span className="st bad">Desactivado</span>}<br />
                    <span className="muted sm">{[p.nombre_contacto, p.telefono, p.email, p.direccion].filter(Boolean).join(", ") || "Sin datos de contacto"}</span>
                  </div>
                  <div className="ctl">
                    <button className="btn mini" onClick={() => setDialogo({ tipo: "editar", proveedor: p })}>Editar</button>
                    {puede(rol, "eliminarProveedor") && <button className="btn mini bad" onClick={() => setDialogo({ tipo: "eliminar", proveedor: p })}>Eliminar</button>}
                  </div>
                </div>
              )) : <p className="muted">No hay proveedores con estos filtros.</p>}
            </section>
          )}
      </div>

      {dialogo && dialogo.tipo !== "eliminar" && <ProveedorDialog proveedor={dialogo.proveedor} onClose={cerrar} onDone={hecho} />}
      {dialogo && dialogo.tipo === "eliminar" && (
        <ConfirmarDialog titulo={`Eliminar ${dialogo.proveedor.nombre_empresa}`} boton="Eliminar proveedor" peligro onClose={cerrar}
          texto="Se borra definitivamente. Si solo dejarás de trabajar con él, mejor desactívalo desde Editar."
          accion={async () => { const r = await proveedoresService.eliminar(dialogo.proveedor.id_proveedor); aviso(r.message); hecho(); }} />
      )}
    </>
  );
}
