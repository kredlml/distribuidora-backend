import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Cargando, ErrorCard, Vacio } from "../../components/Estado";
import Imagen from "../../components/Imagen";
import Select from "../../components/Select";
import { useToast } from "../../context/ToastContext";
import useFetch from "../../hooks/useFetch";
import * as catalogoService from "../../services/catalogoService";
import * as devolucionesService from "../../services/devolucionesService";
import * as pedidosService from "../../services/pedidosService";
import { MOTIVOS_DEVOLUCION, TIPOS_DEVOLUCION } from "../../utils/constants";
import { variante } from "../../utils/format";
import "./Devoluciones.css";

export default function SolicitarDevolucion() {
  const { id } = useParams();
  const navigate = useNavigate();
  const aviso = useToast();

  const datos = useFetch(async () => {
    const [pedido, devolvible] = await Promise.all([pedidosService.obtener(id), pedidosService.devolvible(id)]);
    // Variantes de cada prenda del pedido (para elegir la talla/color del cambio).
    const raices = [...new Set((pedido.DetallePedidos || []).map((l) => (l.Producto ? l.Producto.id_producto_padre || l.Producto.id_producto : l.id_producto)))];
    const grupos = await Promise.all(raices.map((r) => catalogoService.prenda(r).catch(() => null)));
    return { pedido, devolvible, grupos: grupos.filter(Boolean) };
  }, [id]);

  const [tipo, setTipo] = useState("CAMBIO_TALLA");
  const [motivo, setMotivo] = useState("TALLA_INCORRECTA");
  const [observacion, setObservacion] = useState("");
  const [sel, setSel] = useState({}); // id_detalle_pedido -> { cantidad, id_producto_nuevo }
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  const d = datos.data;
  // Por cada línea del pedido: su grupo de variantes (buscado por la prenda base, así funciona
  // aunque la variante comprada ya esté desactivada), lo que se pagó y el producto comprado.
  const porLinea = useMemo(() => {
    const m = new Map();
    if (!d) return m;
    const grupoDeRaiz = new Map(d.grupos.map((g) => [g.id_prenda, g]));
    (d.pedido.DetallePedidos || []).forEach((l) => {
      const raiz = l.Producto ? l.Producto.id_producto_padre || l.Producto.id_producto : l.id_producto;
      m.set(l.id_detalle_pedido, { grupo: grupoDeRaiz.get(raiz), precio: Number(l.precio_unitario), producto: l.Producto });
    });
    return m;
  }, [d]);

  if (datos.loading && !d) return <Cargando>Cargando el pedido…</Cargando>;
  if (datos.error) return <ErrorCard message={datos.error} onRetry={datos.reload} />;
  if (!d) return null;

  const esCambio = tipo !== "DEVOLUCION";
  const lineas = d.devolvible.detalles.filter((l) => l.cantidad_devolvible > 0);

  // Opciones de cambio para una línea según el tipo (otra talla del mismo color, u otro color).
  // Solo variantes que no cuesten más que lo pagado: la diferencia no se puede cobrar en línea.
  const opcionesCambio = (l, t = tipo) => {
    const info = porLinea.get(l.id_detalle_pedido);
    const g = info && info.grupo;
    if (!g || t === "DEVOLUCION") return [];
    const actual = info.producto || l.Producto || {};
    return g.variantes
      .filter((v) => v.id_producto !== l.id_producto)
      .filter((v) => (t === "CAMBIO_TALLA" ? (v.color || "") === (actual.color || "") && v.talla !== actual.talla : (v.color || "") !== (actual.color || "")))
      .filter((v) => Math.round(v.precio_unitario * 100) <= Math.round(info.precio * 100))
      .map((v) => {
        const stock = (v.stock_por_sucursal && v.stock_por_sucursal[d.pedido.id_sucursal]) || 0;
        return [v.id_producto, `${variante(v) || "Única"}${stock > 0 ? "" : " (sin stock por ahora)"}`];
      });
  };

  const marcar = (l, on) => setSel((s) => {
    const n = { ...s };
    if (on) n[l.id_detalle_pedido] = { cantidad: 1, id_producto_nuevo: "" }; else delete n[l.id_detalle_pedido];
    return n;
  });
  const cambiar = (idDet, datosLinea) => setSel((s) => ({ ...s, [idDet]: { ...s[idDet], ...datosLinea } }));

  const enviar = async (ev) => {
    ev.preventDefault();
    setError("");
    const elegidas = Object.entries(sel);
    if (elegidas.length === 0) return setError("Elige al menos una prenda.");
    if (esCambio && elegidas.some(([, v]) => !v.id_producto_nuevo)) return setError("Elige la talla o variante nueva de cada prenda.");
    setEnviando(true);
    try {
      const r = await devolucionesService.solicitar({
        id_pedido: d.pedido.id_pedido, tipo, motivo, observacion: observacion.trim() || undefined,
        detalles: elegidas.map(([idDet, v]) => ({
          id_detalle_pedido: Number(idDet), cantidad: Number(v.cantidad),
          ...(esCambio ? { id_producto_nuevo: Number(v.id_producto_nuevo) } : {}),
        })),
      });
      aviso("Solicitud enviada. Te avisaremos cuando la revisemos.");
      navigate(`/devoluciones/${r.devolucion.id_devolucion}`, { replace: true });
    } catch (e) {
      setError(e.message);
      setEnviando(false);
    }
  };

  return (
    <>
      <Link to={`/pedidos/${id}`} className="back">← Pedido #{id}</Link>
      <div className="head"><h1>Cambio o devolución</h1></div>
      {!d.devolvible.permite_devolucion ? <Vacio>Solo puedes pedir cambios o devoluciones de pedidos entregados.</Vacio>
        : lineas.length === 0 ? <Vacio>Ya solicitaste cambio o devolución de todas las prendas de este pedido.</Vacio>
        : (
          <form className="card stack" onSubmit={enviar}>
            <fieldset className="radios-col">
              <legend className="sm muted">¿Qué necesitas?</legend>
              {TIPOS_DEVOLUCION.map(([v, t]) => (
                <label key={v} className="chk"><input type="radio" name="tipo" value={v} checked={tipo === v}
                  onChange={() => {
                    setTipo(v);
                    // Se descartan las prendas sin opciones para el nuevo tipo (quedarían marcadas sin poder desmarcarse).
                    setSel((s) => Object.fromEntries(Object.entries(s)
                      .filter(([k]) => v === "DEVOLUCION" || opcionesCambio(lineas.find((l) => String(l.id_detalle_pedido) === k) || {}, v).length > 0)
                      .map(([k, x]) => [k, { ...x, id_producto_nuevo: "" }])));
                  }} /><span>{t}</span></label>
              ))}
            </fieldset>
            <label className="sm muted">Motivo
              <Select className="field" value={motivo} onChange={(e) => setMotivo(e.target.value)} options={MOTIVOS_DEVOLUCION} />
            </label>

            <div className="sm muted">Prendas</div>
            {lineas.map((l) => {
              const s = sel[l.id_detalle_pedido];
              const opciones = esCambio ? opcionesCambio(l) : [];
              const g = (porLinea.get(l.id_detalle_pedido) || {}).grupo;
              const foto = g ? ((g.variantes.find((x) => x.id_producto === l.id_producto) || {}).imagen_url || g.imagen_url) : null;
              return (
                <div className="linea-dev" key={l.id_detalle_pedido}>
                  <label className="chk">
                    <input type="checkbox" checked={!!s} disabled={esCambio && opciones.length === 0} onChange={(e) => marcar(l, e.target.checked)} />
                    <span className="linea-dev-info">
                      <Imagen src={foto} alt={l.Producto ? l.Producto.nombre : ""} className="mini" />
                      <span>
                        {l.Producto ? l.Producto.nombre : `Producto #${l.id_producto}`}
                        <span className="muted sm"><br />{l.Producto ? variante(l.Producto) : ""} · puedes {esCambio ? "cambiar" : "devolver"} hasta {l.cantidad_devolvible}</span>
                        {esCambio && opciones.length === 0 && <span className="muted sm"><br />No hay otra {tipo === "CAMBIO_TALLA" ? "talla" : "variante"} de esta prenda al mismo precio o menor.</span>}
                      </span>
                    </span>
                  </label>
                  {s && (
                    <div className="ctl">
                      <label className="sm muted">Cantidad
                        <Select className="pill" value={s.cantidad} onChange={(e) => cambiar(l.id_detalle_pedido, { cantidad: Number(e.target.value) })}
                          options={Array.from({ length: l.cantidad_devolvible }, (_, i) => [i + 1, String(i + 1)])} />
                      </label>
                      {esCambio && (
                        <label className="sm muted">Cambiar por
                          <Select className="pill" value={s.id_producto_nuevo} placeholder="Elige" onChange={(e) => cambiar(l.id_detalle_pedido, { id_producto_nuevo: e.target.value })} options={opciones} />
                        </label>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            <label className="sm muted">Comentario (opcional)
              <textarea className="field" maxLength={255} value={observacion} onChange={(e) => setObservacion(e.target.value)} placeholder="Cuéntanos qué pasó con la prenda" />
            </label>
            <p className="muted sm">Revisaremos tu solicitud. Si la aprobamos, entrega o envía la prenda a la sucursal; tras revisarla, procesamos el cambio o la devolución.</p>
            <div className="err" role="alert">{error}</div>
            <div><button className="btn pri" disabled={enviando}>{enviando ? "Enviando…" : "Enviar solicitud"}</button></div>
          </form>
        )}
    </>
  );
}
