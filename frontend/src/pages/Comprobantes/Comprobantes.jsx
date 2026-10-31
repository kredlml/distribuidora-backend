import { useSearchParams } from "react-router-dom";
import { ChipBar } from "../../components/Chip";
import ComprobanteDialog from "../../components/ComprobanteDialog";
import { Cargando, ErrorCard } from "../../components/Estado";
import Paginador from "../../components/Paginador";
import SearchBox from "../../components/SearchBox";
import Select from "../../components/Select";
import { useAuth } from "../../context/AuthContext";
import useDebounced, { useCorregirPagina } from "../../hooks/useDebounced";
import useFetch from "../../hooks/useFetch";
import * as comprobantesService from "../../services/comprobantesService";
import * as sucursalesService from "../../services/sucursalesService";
import { CONCEPTOS } from "../../utils/constants";
import { dinero, fecha, nombreEmp } from "../../utils/format";
import { puede } from "../../utils/permisos";

const POR_TIPO = {
  ENTRADA: ["INGRESO_PROVEEDOR", "INGRESO_DIRECTO", "DEVOLUCION", "CAMBIO"],
  SALIDA: ["VENTA", "BAJA", "CAMBIO"],
};

/** Comprobantes de entrada y salida de mercadería: los emite el sistema al ingresar mercadería,
 *  vender, dar de baja stock, reintegrar devoluciones y procesar cambios. Filtros en la URL. */
export default function Comprobantes() {
  const { rol } = useAuth();
  const [params, setParams] = useSearchParams();
  const f = { tipo: params.get("tipo") || "", concepto: params.get("concepto") || "", id_sucursal: params.get("sucursal") || "", desde: params.get("desde") || "", hasta: params.get("hasta") || "" };
  const q = params.get("q") || "";
  const pagina = Number(params.get("pagina")) || 1;
  const abierto = params.get("ver");
  const cambiar = (clave, valor) => {
    const n = new URLSearchParams(params);
    if (valor) n.set(clave, valor); else n.delete(clave);
    if (!["pagina", "ver"].includes(clave)) n.delete("pagina");
    if (clave === "tipo") n.delete("concepto");
    // Abrir un comprobante agrega una entrada al historial (Atrás lo cierra); cerrarlo, no.
    setParams(n, { replace: !(clave === "ver" && valor) });
  };
  const qBuscar = useDebounced(q.trim());
  const todas = puede(rol, "todasLasSucursales");

  const sucs = useFetch(() => sucursalesService.listar(), [], todas);
  const { data, error, loading, reload } = useFetch(() => comprobantesService.listar({ ...f, q: qBuscar, pagina }),
    [f.tipo, f.concepto, f.id_sucursal, f.desde, f.hasta, qBuscar, pagina]);
  useCorregirPagina(data, (n) => cambiar("pagina", String(n)));
  const lista = (data && data.datos) || [];
  const conceptos = (f.tipo ? POR_TIPO[f.tipo] : Object.keys(CONCEPTOS)).map((k) => [k, CONCEPTOS[k]]);

  return (
    <>
      <div className="head">
        <div>
          <h1>Comprobantes</h1>
          <div className="muted sm">Entradas y salidas de mercadería. Se generan solos al ingresar stock, vender, dar de baja y procesar devoluciones o cambios; no se pueden editar.</div>
        </div>
      </div>
      <div className="bar">
        <SearchBox label="Buscar" placeholder="Folio (CE-000012), proveedor, factura o número de pedido" value={q} onChange={(ev) => cambiar("q", ev.target.value)} />
      </div>
      <ChipBar items={[["", "Todos"], ["ENTRADA", "Entradas"], ["SALIDA", "Salidas"]]} value={f.tipo} onChange={(v) => cambiar("tipo", v)} />
      <div className="bar">
        <Select className="pill" aria-label="Concepto" value={f.concepto} placeholder="Todos los conceptos" onChange={(ev) => cambiar("concepto", ev.target.value)} options={conceptos} />
        {todas && (
          <Select className="pill" aria-label="Sucursal" value={f.id_sucursal} placeholder="Todas las sucursales" onChange={(ev) => cambiar("sucursal", ev.target.value)}
            options={(sucs.data || []).map((s) => [s.id_sucursal, s.nombre])} />
        )}
        <label className="sm muted">Desde <input className="pill" type="date" aria-label="Desde" value={f.desde} max={f.hasta || undefined} onChange={(ev) => cambiar("desde", ev.target.value)} /></label>
        <label className="sm muted">Hasta <input className="pill" type="date" aria-label="Hasta" value={f.hasta} min={f.desde || undefined} onChange={(ev) => cambiar("hasta", ev.target.value)} /></label>
      </div>
      <div className="stack comprobantes">
        {loading && !data ? <Cargando>Cargando comprobantes…</Cargando>
          : error ? <ErrorCard message={error} onRetry={reload} />
          : lista.length ? (
            <section className={`card ${loading ? "recargando" : ""}`} aria-busy={loading}>
              <h2>{loading ? "Actualizando…" : `${data.total} comprobante${data.total === 1 ? "" : "s"}`}</h2>
              {lista.map((c) => (
                <button type="button" className="fila-comprobante" key={c.id_comprobante} onClick={() => cambiar("ver", String(c.id_comprobante))}>
                  <span className="folio-mini">{c.folio}</span>
                  <span>
                    {CONCEPTOS[c.concepto] || c.concepto}{c.Proveedor ? `, ${c.Proveedor.nombre_empresa}` : ""}{c.documento_proveedor ? ` (${c.documento_proveedor})` : ""}{c.id_pedido ? `, pedido #${c.id_pedido}` : ""}<br />
                    <span className="muted sm">{fecha(c.fecha)}, {c.Sucursal ? c.Sucursal.nombre : `Sucursal ${c.id_sucursal}`}, {c.Empleado ? nombreEmp(c.Empleado) : "Sistema"}</span>
                  </span>
                  <span className="num">
                    <span className={`st ${c.tipo === "ENTRADA" ? "ok" : ""}`}>{c.tipo === "ENTRADA" ? "Entrada" : "Salida"}</span><br />
                    <span className="sm">{c.total_unidades} u.{c.valor_total != null ? ` · ${dinero(c.valor_total)}` : ""}</span>
                  </span>
                </button>
              ))}
              <Paginador datos={data} nombre="comprobantes" onPagina={(n) => cambiar("pagina", String(n))} />
            </section>
          ) : <Cargando>{q || Object.values(f).some(Boolean) ? "No hay comprobantes con estos filtros." : "Aún no hay comprobantes. Se generan al ingresar mercadería en Catálogo y stock, y con cada venta pagada."}</Cargando>}
      </div>
      {abierto && <ComprobanteDialog id={abierto} onClose={() => cambiar("ver", "")} />}
    </>
  );
}
