import { useState } from "react";
import { Link } from "react-router-dom";
import { ChipBar } from "../../components/Chip";
import { Cargando, ErrorCard } from "../../components/Estado";
import SearchBox from "../../components/SearchBox";
import useFetch from "../../hooks/useFetch";
import * as clientesService from "../../services/clientesService";
import ClienteDialog from "./ClienteDialog";
import CodigoWebDialog from "./CodigoWebDialog";
import "./Clientes.css";

const FILTROS = [["", "Activos"], ["web", "Con cuenta web"], ["mostrador", "Solo mostrador"], ["inactivos", "Desactivados"]];
const pasa = (c, f) => (f === "inactivos" ? c.activo === false
  : c.activo !== false && (f === "web" ? c.tiene_cuenta_web : f === "mostrador" ? !c.tiene_cuenta_web : true));

export default function Clientes() {
  const [filtro, setFiltro] = useState("");
  const [q, setQ] = useState("");
  const [dialogo, setDialogo] = useState(null); // { tipo: "nuevo" | "editar" | "codigo", cliente }
  const { data, error, loading, reload } = useFetch(() => clientesService.listar(), []);

  const texto = q.trim().toLowerCase();
  const lista = (data || []).filter((c) => pasa(c, filtro))
    .filter((c) => !texto || `${c.nombre} ${c.apellido} ${c.email || ""} ${c.telefono || ""} #${c.id_cliente}`.toLowerCase().includes(texto))
    .sort((a, b) => b.id_cliente - a.id_cliente);
  const cerrar = () => setDialogo(null);
  const hecho = () => { cerrar(); reload(); };

  return (
    <>
      <div className="head">
        <div><h1>Clientes</h1><div className="muted sm">Clientes de mostrador y de la tienda en línea. Los de la tienda se registran solos.</div></div>
        <button className="btn pri" onClick={() => setDialogo({ tipo: "nuevo" })}>Nuevo cliente</button>
      </div>
      <div className="bar"><SearchBox label="Buscar" placeholder="Buscar por nombre, correo, teléfono o número" value={q} onChange={(ev) => setQ(ev.target.value)} /></div>
      <ChipBar items={FILTROS} value={filtro} onChange={setFiltro} />
      <div className="stack">
        {loading && !data ? <Cargando>Cargando clientes…</Cargando>
          : error ? <ErrorCard message={error} onRetry={reload} />
          : (
            <section className="card">
              <h2>{lista.length} cliente{lista.length === 1 ? "" : "s"}</h2>
              {lista.length ? lista.map((c) => (
                <div className="item" key={c.id_cliente}>
                  <div>
                    {c.nombre} {c.apellido} <span className={`st ${c.tiene_cuenta_web ? "ok" : ""}`}>{c.tiene_cuenta_web ? "Cuenta web" : "Mostrador"}</span>
                    {c.activo === false && <> <span className="st bad">Desactivado</span></>}
                    <br />
                    <span className="muted sm">#{c.id_cliente}, {[c.email, c.telefono].filter(Boolean).join(", ") || "sin datos de contacto"}</span>
                  </div>
                  <div className="ctl">
                    <Link className="btn mini" to={`/pedidos?cliente=${c.id_cliente}`}>Pedidos</Link>
                    <button className="btn mini" onClick={() => setDialogo({ tipo: "editar", cliente: c })}>Editar</button>
                    {!c.tiene_cuenta_web && c.activo !== false && <button className="btn mini" onClick={() => setDialogo({ tipo: "codigo", cliente: c })}>Código web</button>}
                  </div>
                </div>
              )) : <p className="muted">No hay clientes con estos filtros.</p>}
            </section>
          )}
      </div>

      {dialogo && dialogo.tipo !== "codigo" && <ClienteDialog cliente={dialogo.cliente} onClose={cerrar} onDone={hecho} />}
      {dialogo && dialogo.tipo === "codigo" && <CodigoWebDialog cliente={dialogo.cliente} onClose={cerrar} />}
    </>
  );
}
