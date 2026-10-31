import { useState } from "react";
import { Cargando, ErrorCard } from "../../components/Estado";
import Modal from "../../components/Modal";
import { useToast } from "../../context/ToastContext";
import useFetch from "../../hooks/useFetch";
import * as cuponesService from "../../services/cuponesService";
import * as sucursalesService from "../../services/sucursalesService";
import { dinero } from "../../utils/format";

const valorDe = (c) => (c.tipo === "PORCENTAJE" ? `${Number(c.valor)}%` : dinero(c.valor));
const vigencia = (c) => (c.desde || c.hasta ? `${c.desde || "…"} a ${c.hasta || "…"}` : "Sin fecha límite");

/** Promociones (DISTRITAL): cupones de descuento para la tienda en línea y las ventas de mostrador. */
export default function Promociones() {
  const aviso = useToast();
  const [dialogo, setDialogo] = useState(null); // null | { cupon? }
  const { data, error, loading, reload } = useFetch(() => cuponesService.listar(), []);
  const sucs = useFetch(() => sucursalesService.listar(), []);

  const alternar = async (c) => {
    try { await cuponesService.actualizar(c.id_cupon, { activo: !c.activo }); aviso(c.activo ? "Cupón desactivado." : "Cupón activado."); reload(); }
    catch (e) { aviso(e.message, true); }
  };
  const eliminar = async (c) => {
    try { await cuponesService.eliminar(c.id_cupon); aviso("Cupón eliminado."); reload(); }
    catch (e) { aviso(e.message, true); }
  };

  return (
    <>
      <div className="head">
        <div><h1>Promociones</h1><div className="muted sm">Cupones de descuento. La clienta escribe el código al pagar en la tienda; en mostrador lo ingresa caja.</div></div>
        <button className="btn pri" onClick={() => setDialogo({})}>Nuevo cupón</button>
      </div>
      {loading && !data ? <Cargando>Cargando cupones…</Cargando>
        : error ? <ErrorCard message={error} onRetry={reload} />
        : (
          <section className="card">
            <h2>{data.length} cupón{data.length === 1 ? "" : "es"}</h2>
            {data.length ? data.map((c) => (
              <div className="item" key={c.id_cupon}>
                <div>
                  <b>{c.codigo}</b> {valorDe(c)} de descuento <span className={`st ${c.activo ? "ok" : "bad"}`}>{c.activo ? "Activo" : "Inactivo"}</span><br />
                  <span className="muted sm">
                    {c.descripcion ? `${c.descripcion} · ` : ""}{vigencia(c)}
                    {Number(c.minimo_compra) > 0 ? ` · compra mínima ${dinero(c.minimo_compra)}` : ""}
                    {` · ${c.Sucursal ? c.Sucursal.nombre : "todas las sucursales"}`}
                    {` · usado ${c.usos}${c.usos_maximos ? ` de ${c.usos_maximos}` : ""} vez/veces, ${dinero(c.descuento_total)} descontados`}
                  </span>
                </div>
                <div className="ctl">
                  <button className="btn mini" onClick={() => setDialogo({ cupon: c })}>Editar</button>
                  <button className="btn mini" onClick={() => alternar(c)}>{c.activo ? "Desactivar" : "Activar"}</button>
                  {c.pedidos === 0 && c.usos === 0 && <button className="btn mini bad" onClick={() => eliminar(c)}>Eliminar</button>}
                </div>
              </div>
            )) : <p className="muted">Aún no hay cupones.</p>}
          </section>
        )}
      {dialogo && <CuponDialog cupon={dialogo.cupon} sucursales={sucs.data || []} onClose={() => setDialogo(null)} onDone={(msg) => { setDialogo(null); aviso(msg); reload(); }} />}
    </>
  );
}

function CuponDialog({ cupon, sucursales, onClose, onDone }) {
  const [tipo, setTipo] = useState(cupon ? cupon.tipo : "PORCENTAJE");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const usado = cupon && cupon.usos > 0;

  const enviar = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    const body = {
      descripcion: fd.get("descripcion").trim(),
      valor: Number(fd.get("valor")),
      minimo_compra: Number(fd.get("minimo_compra") || 0),
      desde: fd.get("desde") || null, hasta: fd.get("hasta") || null,
      usos_maximos: fd.get("usos_maximos") ? Number(fd.get("usos_maximos")) : null,
      id_sucursal: fd.get("id_sucursal") ? Number(fd.get("id_sucursal")) : null,
    };
    if (!usado) { body.codigo = fd.get("codigo").trim().toUpperCase(); body.tipo = tipo; }
    setError(""); setEnviando(true);
    try {
      if (cupon) await cuponesService.actualizar(cupon.id_cupon, body); else await cuponesService.crear(body);
      onDone(cupon ? "Cupón actualizado." : "Cupón creado.");
    } catch (e) { setError(e.message); setEnviando(false); }
  };

  return (
    <Modal onClose={onClose}>
      <form onSubmit={enviar} className="stack">
        <h1>{cupon ? `Editar ${cupon.codigo}` : "Nuevo cupón"}</h1>
        {usado && <p className="muted sm">Ya se usó {cupon.usos} vez/veces: el código y el tipo no se pueden cambiar.</p>}
        <label className="sm muted">Código (lo que escribe la clienta)
          <input className="field" name="codigo" required={!usado} disabled={usado} defaultValue={cupon ? cupon.codigo : ""} pattern="[A-Za-z0-9_\-]{3,30}" maxLength={30} placeholder="VERANO10" />
        </label>
        <label className="sm muted">Descripción<input className="field" name="descripcion" maxLength={150} defaultValue={cupon ? cupon.descripcion || "" : ""} placeholder="10% en toda la tienda" /></label>
        <div className="grid2">
          <label className="sm muted">Tipo
            <select className="field" value={tipo} disabled={usado} onChange={(e) => setTipo(e.target.value)}>
              <option value="PORCENTAJE">Porcentaje (%)</option>
              <option value="MONTO">Monto fijo (Q)</option>
            </select>
          </label>
          <label className="sm muted">{tipo === "PORCENTAJE" ? "Porcentaje" : "Monto en Q"}
            <input className="field" name="valor" type="number" step="0.01" min="0.01" max={tipo === "PORCENTAJE" ? 100 : undefined} required defaultValue={cupon ? Number(cupon.valor) : ""} />
          </label>
        </div>
        <div className="grid2">
          <label className="sm muted">Compra mínima (Q)<input className="field" name="minimo_compra" type="number" step="0.01" min="0" defaultValue={cupon ? Number(cupon.minimo_compra) : 0} /></label>
          <label className="sm muted">Usos máximos (vacío = ilimitado)<input className="field" name="usos_maximos" type="number" min={cupon ? Math.max(1, cupon.usos) : 1} defaultValue={cupon && cupon.usos_maximos ? cupon.usos_maximos : ""} /></label>
        </div>
        <div className="grid2">
          <label className="sm muted">Válido desde<input className="field" name="desde" type="date" defaultValue={cupon ? cupon.desde || "" : ""} /></label>
          <label className="sm muted">Válido hasta<input className="field" name="hasta" type="date" defaultValue={cupon ? cupon.hasta || "" : ""} /></label>
        </div>
        <label className="sm muted">Sucursal
          <select className="field" name="id_sucursal" defaultValue={cupon && cupon.id_sucursal ? cupon.id_sucursal : ""}>
            <option value="">Todas las sucursales</option>
            {sucursales.map((s) => <option key={s.id_sucursal} value={s.id_sucursal}>{s.nombre}</option>)}
          </select>
        </label>
        <div className="err" role="alert">{error}</div>
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn pri" disabled={enviando}>{enviando ? "Guardando…" : "Guardar"}</button>
        </div>
      </form>
    </Modal>
  );
}
