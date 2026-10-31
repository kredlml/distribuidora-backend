import { useState } from "react";
import { Cargando, ErrorCard } from "../../components/Estado";
import Paginador from "../../components/Paginador";
import useFetch from "../../hooks/useFetch";
import * as saludService from "../../services/saludService";
import { fecha } from "../../utils/format";

const SERVICIO = { correo: "Correo", stripe: "Pagos con tarjeta (Stripe)", cloudinary: "Fotos (Cloudinary)", sentry: "Sentry" };
const ESTADO_CORREO = { smtp: "Envía por SMTP", consola: "Sin SMTP: no se envían (solo consola)", archivo: "Guardados en archivos (pruebas)" };

/** Estado del sistema (DISTRITAL): ¿responde la base?, migraciones, pendientes y errores del servidor. */
export default function Sistema() {
  const [pagina, setPagina] = useState(1);
  const d = useFetch(() => saludService.detalle(), []);
  const e = useFetch(() => saludService.errores(pagina), [pagina]);

  if (d.loading && !d.data) return <Cargando>Revisando el sistema…</Cargando>;
  if (d.error) return <ErrorCard message={d.error} onRetry={d.reload} />;
  const s = d.data;
  const avisos = [
    s.base !== "ok" && "La base de datos no responde.",
    s.migraciones && s.migraciones.pendientes.length && `Hay ${s.migraciones.pendientes.length} migración(es) sin aplicar: reinicia el servidor o corre «npm run migrar».`,
    s.esquema_faltante && s.esquema_faltante.length && `Faltan en la base: ${s.esquema_faltante.join(", ")} (falta escribir una migración).`,
    s.servicios && s.servicios.correo === "consola" && "No hay SMTP configurado: las clientas no reciben correos.",
    s.pendientes && s.pendientes.reembolsos_fallidos > 0 && `${s.pendientes.reembolsos_fallidos} reembolso(s) que Stripe rechazó esperan entrega en efectivo.`,
  ].filter(Boolean);

  return (
    <>
      <div className="head">
        <div><h1>Estado del sistema</h1><div className="muted sm">Revisado {fecha(s.hora)} · en marcha desde {fecha(s.en_marcha_desde)}</div></div>
        <button className="btn" onClick={() => { d.reload(); e.reload(); }}>Actualizar</button>
      </div>
      {avisos.length > 0 && <section className="card err sec">{avisos.map((a) => <div key={a}>{a}</div>)}</section>}
      <div className="cols sec">
        <section className="card">
          <h2>Base de datos</h2>
          <div className="kv">
            <div><b>Estado</b><span className={`st ${s.base === "ok" ? "ok" : "bad"}`}>{s.base === "ok" ? "Responde" : "Sin respuesta"}</span></div>
            <div><b>Latencia</b>{s.latencia_base_ms} ms</div>
            <div><b>Migraciones aplicadas</b>{s.migraciones ? s.migraciones.aplicadas : "—"}</div>
            <div><b>Última migración</b>{s.migraciones && s.migraciones.ultima ? s.migraciones.ultima : "—"}</div>
            <div><b>Memoria del servidor</b>{s.memoria_mb} MB</div>
            <div><b>Node</b>{s.version_node}</div>
          </div>
        </section>
        <section className="card">
          <h2>Pendientes y servicios</h2>
          <div className="kv">
            <div><b>Pedidos sin pagar</b>{s.pendientes ? s.pendientes.pedidos_pendientes : "—"}</div>
            <div><b>Reembolsos pendientes</b>{s.pendientes ? s.pendientes.reembolsos_pendientes : "—"}</div>
            <div><b>Plazo para pagar un pedido</b>{s.servicios && s.servicios.vencimiento_pedidos_horas ? `${s.servicios.vencimiento_pedidos_horas} h` : "Desactivado"}</div>
            {s.servicios && Object.entries(SERVICIO).map(([k, t]) => (
              <div key={k}><b>{t}</b>{k === "correo" ? ESTADO_CORREO[s.servicios.correo] || s.servicios.correo : s.servicios[k]}</div>
            ))}
          </div>
        </section>
      </div>

      <section className="card sec">
        <h2>Errores del servidor {s.errores ? <span className="muted sm">({s.errores.dia} en 24 h, {s.errores.semana} en 7 días)</span> : null}</h2>
        {e.loading && !e.data ? <Cargando>Cargando errores…</Cargando>
          : e.error ? <p className="err">{e.error}</p>
          : e.data.datos.length ? e.data.datos.map((x) => (
            <div className="item" key={x.id}>
              <div>
                <b>{x.estado}</b> {x.metodo} {x.ruta}<br />
                <span className="sm">{x.mensaje}</span><br />
                <span className="muted sm">{fecha(x.fecha)}{x.usuario ? `, ${x.usuario}` : ""}{x.request_id ? `, ref. ${x.request_id}` : ""}</span>
              </div>
            </div>
          )) : <p className="muted">Sin errores registrados.</p>}
        <Paginador datos={e.data} nombre="errores" onPagina={setPagina} />
      </section>
    </>
  );
}
