import { useState } from "react";
import { ChipBar } from "../../components/Chip";
import { Cargando, ErrorCard } from "../../components/Estado";
import Select from "../../components/Select";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import useFetch from "../../hooks/useFetch";
import * as reportesService from "../../services/reportesService";
import * as sucursalesService from "../../services/sucursalesService";
import { METODOS_PAGO, ORIGENES } from "../../utils/constants";
import { dinero, prod } from "../../utils/format";
import { puede } from "../../utils/permisos";
import { descargarReportePdf } from "../../utils/reportePdf";
import "../Pedidos/Pedidos.css";
import "./Reportes.css";

const NOMBRE_ORIGEN = Object.fromEntries(ORIGENES);
// Días de Guatemala (no del navegador), igual que el servidor.
const hoyGT = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date());
const sumarDias = (dia, n) => { const d = new Date(`${dia}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const RANGOS = [["hoy", "Hoy"], ["7", "Últimos 7 días"], ["30", "Últimos 30 días"], ["mes", "Este mes"], ["otro", "Personalizado"]];
function rango(clave, desde, hasta) {
  const hoy = hoyGT();
  if (clave === "hoy") return [hoy, hoy];
  if (clave === "7") return [sumarDias(hoy, -6), hoy];
  if (clave === "30") return [sumarDias(hoy, -29), hoy];
  if (clave === "mes") return [`${hoy.slice(0, 8)}01`, hoy];
  return [desde, hasta];
}
const diaCorto = (d) => new Date(`${d}T12:00:00`).toLocaleDateString("es-GT", { day: "numeric", month: "short" });

/** Barra horizontal proporcional al máximo de la serie. */
const Barra = ({ valor, max }) => <span className="barra"><span style={{ width: `${max ? Math.max(2, (valor / max) * 100) : 0}%` }} /></span>;

export default function Reportes() {
  const { rol, sesion } = useAuth();
  const aviso = useToast();
  const distrital = puede(rol, "todasLasSucursales");
  const [clave, setClave] = useState("hoy");
  const [propio, setPropio] = useState(() => [sumarDias(hoyGT(), -6), hoyGT()]);
  const [idSucursal, setIdSucursal] = useState("");
  const [desde, hasta] = rango(clave, propio[0], propio[1]);
  const [generando, setGenerando] = useState(false);

  const sucs = useFetch(() => (distrital ? sucursalesService.listar() : Promise.resolve([])), [distrital]);
  const { data: r, error, loading, reload } = useFetch(() => reportesService.resumen({ desde, hasta, id_sucursal: idSucursal }), [desde, hasta, idSucursal]);

  const tituloSucursal = r && r.sucursal ? `Sucursal ${r.sucursal.nombre}` : distrital ? "Todas las sucursales" : `Sucursal ${(sesion && sesion.sucursal) || ""}`;
  const pdf = async () => {
    setGenerando(true);
    try { await descargarReportePdf(r, { titulo: tituloSucursal }); aviso("Reporte PDF descargado."); }
    catch (e) { aviso("No se pudo generar el PDF: " + e.message, true); }
    finally { setGenerando(false); }
  };

  const k = r && r.kpis;
  const maxDia = r ? Math.max(0, ...r.por_dia.map((d) => d.ventas)) : 0;
  const maxSuc = r ? Math.max(0, ...r.por_sucursal.map((s) => s.ventas)) : 0;
  const maxPrenda = r ? Math.max(0, ...r.por_prenda.map((p) => p.unidades)) : 0;
  const maxTipo = r ? Math.max(0, ...r.por_tipo.map((t) => t.ventas)) : 0;

  return (
    <>
      <div className="head">
        <div>
          <h1>Reportes de ventas</h1>
          <div className="muted sm">{distrital ? "Ventas de todas las sucursales o de la que elijas." : `Ventas de tu sucursal${sesion && sesion.sucursal ? ` (${sesion.sucursal})` : ""}.`} Cuentan los pedidos ya pagados.</div>
        </div>
        <button className="btn pri" disabled={!r || loading || generando} onClick={pdf}>{generando ? "Generando…" : "Descargar PDF"}</button>
      </div>

      <ChipBar items={RANGOS} value={clave} onChange={setClave} />
      <div className="bar">
        {clave === "otro" && (
          <>
            <label className="sm muted fecha-filtro">Desde<input className="pill" type="date" value={propio[0]} max={propio[1]} onChange={(e) => e.target.value && setPropio([e.target.value, propio[1]])} /></label>
            <label className="sm muted fecha-filtro">Hasta<input className="pill" type="date" value={propio[1]} min={propio[0]} max={hoyGT()} onChange={(e) => e.target.value && setPropio([propio[0], e.target.value])} /></label>
          </>
        )}
        {distrital && (
          <Select className="pill" aria-label="Sucursal" value={idSucursal} placeholder="Todas las sucursales" onChange={(e) => setIdSucursal(e.target.value)}
            options={(sucs.data || []).map((s) => [s.id_sucursal, s.nombre])} />
        )}
      </div>

      {loading && !r ? <Cargando>Calculando ventas…</Cargando>
        : error ? <ErrorCard message={error} onRetry={reload} />
        : r && (
          <div className={`stack ${loading ? "recargando" : ""}`}>
            <section className="kpis">
              <Kpi titulo="Ventas del periodo" valor={dinero(k.ventas)} nota={`${k.pedidos} pedido${k.pedidos === 1 ? "" : "s"} pagado${k.pedidos === 1 ? "" : "s"}`} destacado />
              <Kpi titulo="Ventas de hoy" valor={dinero(k.ventas_hoy)} nota={`${k.pedidos_hoy} pedido${k.pedidos_hoy === 1 ? "" : "s"}`} />
              <Kpi titulo="Ticket promedio" valor={dinero(k.ticket_promedio)} nota="por pedido" />
              <Kpi titulo="Unidades vendidas" valor={k.unidades} nota="prendas" />
              <Kpi titulo="Por cobrar" valor={dinero(k.pendientes_cobro.monto)} nota={`${k.pendientes_cobro.pedidos} pedido${k.pendientes_cobro.pedidos === 1 ? "" : "s"} pendiente${k.pendientes_cobro.pedidos === 1 ? "" : "s"}`} />
              <Kpi titulo="Cancelados" valor={k.cancelados} nota="en el periodo" />
              <Kpi titulo="Devoluciones" valor={k.devoluciones.devoluciones} nota="solicitadas en el periodo" />
              <Kpi titulo="Cambios" valor={k.devoluciones.cambios} nota="de talla o color" />
            </section>

            {distrital && !idSucursal && r.por_sucursal.length > 0 && (
              <section className="card">
                <h2>Ventas por sucursal</h2>
                <div className="tabla">
                  {r.por_sucursal.map((s) => (
                    <div className="fila-rep" key={s.id_sucursal}>
                      <span>{s.nombre}<br /><span className="muted sm">{s.pedidos} pedido{s.pedidos === 1 ? "" : "s"}, {s.unidades} u.</span></span>
                      <Barra valor={s.ventas} max={maxSuc} />
                      <span className="num">{dinero(s.ventas)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="card">
              <h2>Ventas por día</h2>
              {r.por_dia.length ? (
                <div className="columnas" role="img" aria-label="Gráfica de ventas por día">
                  {r.por_dia.map((d) => (
                    <div className="columna" key={d.dia} title={`${diaCorto(d.dia)}: ${dinero(d.ventas)} en ${d.pedidos} pedidos`}>
                      <span className="valor">{dinero(d.ventas)}</span>
                      <span className="col" style={{ height: `${maxDia ? Math.max(3, (d.ventas / maxDia) * 100) : 0}%` }} />
                      <span className="dia">{diaCorto(d.dia)}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="muted">No hubo ventas pagadas en este periodo.</p>}
            </section>

            <div className="cols">
              <section className="card">
                <h2>Prendas más vendidas</h2>
                {r.por_prenda.length ? (
                  <div className="tabla">
                    {r.por_prenda.slice(0, 10).map((p, i) => (
                      <div className="fila-rep" key={p.id_producto}>
                        <span><span className="muted">{i + 1}.</span> {prod(p)}<br /><span className="muted sm">{p.tipo || "Sin tipo"}, {dinero(p.ventas)}</span></span>
                        <Barra valor={p.unidades} max={maxPrenda} />
                        <span className="num">{p.unidades} u.</span>
                      </div>
                    ))}
                    {r.por_prenda.length > 10 && <p className="muted sm">Y {r.por_prenda.length - 10} prendas más (todas aparecen en el PDF).</p>}
                  </div>
                ) : <p className="muted">Sin ventas en el periodo.</p>}
              </section>
              <section className="card">
                <h2>Por tipo de prenda</h2>
                {r.por_tipo.length ? (
                  <div className="tabla">
                    {r.por_tipo.map((t) => (
                      <div className="fila-rep" key={t.tipo}>
                        <span>{t.tipo}<br /><span className="muted sm">{t.unidades} u.</span></span>
                        <Barra valor={t.ventas} max={maxTipo} />
                        <span className="num">{dinero(t.ventas)}</span>
                      </div>
                    ))}
                  </div>
                ) : <p className="muted">Sin ventas en el periodo.</p>}
              </section>
            </div>

            <div className="cols">
              <section className="card">
                <h2>Cobros por método de pago</h2>
                {r.por_metodo.length ? r.por_metodo.map((m) => (
                  <div className="fila-total" key={m.metodo}><span>{METODOS_PAGO[m.metodo] || m.metodo} <span className="muted sm">({m.pagos})</span></span><span>{dinero(m.monto)}</span></div>
                )) : <p className="muted">Sin cobros en el periodo.</p>}
                <h2 className="sec">Por origen</h2>
                {r.por_origen.length ? r.por_origen.map((o) => (
                  <div className="fila-total" key={o.origen}><span>{NOMBRE_ORIGEN[o.origen] || o.origen} <span className="muted sm">({o.pedidos})</span></span><span>{dinero(o.ventas)}</span></div>
                )) : <p className="muted">Sin ventas en el periodo.</p>}
              </section>
              <section className="card">
                <h2>Ventas por vendedor (mostrador)</h2>
                {r.por_vendedor.length ? r.por_vendedor.map((v) => (
                  <div className="fila-total" key={`${v.id_empleado}-${v.sucursal}`}>
                    <span>{v.nombre} {v.apellido}{distrital && !idSucursal ? <span className="muted sm">, {v.sucursal}</span> : null} <span className="muted sm">({v.pedidos})</span></span>
                    <span>{dinero(v.ventas)}</span>
                  </div>
                )) : <p className="muted">Sin ventas de mostrador en el periodo.</p>}
              </section>
            </div>

            <section className="card">
              <h2>Stock crítico {r.stock_critico.length ? `(${r.stock_critico.length})` : ""}</h2>
              <p className="muted sm">Prendas activas con stock disponible en su mínimo o por debajo. Conviene pedir al proveedor.</p>
              {r.stock_critico.length ? r.stock_critico.map((s) => (
                <div className="fila-total" key={`${s.id_producto}-${s.id_sucursal}`}>
                  <span>{prod(s)}{distrital && !idSucursal ? <span className="muted sm">, {s.sucursal}</span> : null}</span>
                  <span className={s.stock === 0 ? "err" : ""}>{s.stock} / mín. {s.stock_minimo}</span>
                </div>
              )) : <p className="muted">Todo el stock está por encima del mínimo.</p>}
            </section>
          </div>
        )}
    </>
  );
}

function Kpi({ titulo, valor, nota, destacado }) {
  return (
    <div className={`card kpi ${destacado ? "destacado" : ""}`}>
      <span className="muted sm">{titulo}</span>
      <b>{valor}</b>
      <span className="muted sm">{nota}</span>
    </div>
  );
}
