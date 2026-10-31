import { useState } from "react";
import { Link } from "react-router-dom";
import { ChipBar } from "../../components/Chip";
import { Cargando, ErrorCard } from "../../components/Estado";
import Paginador from "../../components/Paginador";
import SearchBox from "../../components/SearchBox";
import useDebounced, { useCorregirPagina } from "../../hooks/useDebounced";
import useFetch from "../../hooks/useFetch";
import * as clientesService from "../../services/clientesService";
import * as sucursalesService from "../../services/sucursalesService";
import ClienteDialog from "./ClienteDialog";
import CodigoWebDialog from "./CodigoWebDialog";
import "./Clientes.css";

const FILTROS = [["", "Activos"], ["web", "Con cuenta web"], ["mostrador", "Solo mostrador"], ["inactivos", "Desactivados"]];

export default function Clientes() {
  const [filtro, setFiltroEstado] = useState("");
  const [q, setQEstado] = useState("");
  const [pagina, setPagina] = useState(1);
  // Cambiar el filtro o la búsqueda vuelve a la primera página.
  const setFiltro = (v) => { setFiltroEstado(v); setPagina(1); };
  const setQ = (v) => { setQEstado(v); setPagina(1); };
  const [dialogo, setDialogo] = useState(null); // { tipo: "nuevo" | "editar" | "codigo", cliente }
  const qBuscar = useDebounced(q.trim());
  const { data, error, loading, reload } = useFetch(() => clientesService.listarPagina({ q: qBuscar, filtro, pagina }), [qBuscar, filtro, pagina]);
  const sucs = useFetch(() => sucursalesService.listar(), []);

  useCorregirPagina(data, setPagina);
  const lista = (data && data.datos) || [];
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
              <h2>{data.total} cliente{data.total === 1 ? "" : "s"}</h2>
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
              <Paginador datos={data} nombre="clientes" onPagina={setPagina} />
            </section>
          )}
      </div>

      {dialogo && dialogo.tipo !== "codigo" && <ClienteDialog cliente={dialogo.cliente} sucursales={sucs.data || []} onClose={cerrar} onDone={hecho} />}
      {dialogo && dialogo.tipo === "codigo" && <CodigoWebDialog cliente={dialogo.cliente} onClose={cerrar} />}
    </>
  );
}
