import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Select from "../../components/Select";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import useFetch from "../../hooks/useFetch";
import * as clientesService from "../../services/clientesService";
import * as devolucionesService from "../../services/devolucionesService";
import * as pedidosService from "../../services/pedidosService";
import * as productosService from "../../services/productosService";
import { MOTIVOS, TIPOS } from "../../utils/constants";
import { fecha, humanizar, prod } from "../../utils/format";
import { PERMISOS } from "../../utils/permisos";
import LineaPrenda from "./LineaPrenda";

const raiz = (p) => Number(p.id_producto_padre || p.id_producto);

export default function NuevaSolicitud() {
  const { rol } = useAuth();
  const aviso = useToast();
  const navigate = useNavigate();
  const crea = PERMISOS.crear.includes(rol);

  const [idCliente, setIdCliente] = useState("");
  const [idPedido, setIdPedido] = useState("");
  const [lineas, setLineas] = useState({}); // índice -> { marcada, cantidad, nuevo }
  const [tipo, setTipo] = useState("");
  const [motivo, setMotivo] = useState("");
  const [obs, setObs] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  const base = useFetch(() => Promise.all([clientesService.listar(), productosService.listar()]), []);
  const pedidos = useFetch(() => pedidosService.listarEntregados(idCliente), [idCliente], !!idCliente);
  const infoQ = useFetch(() => devolucionesService.devolvible(idPedido), [idPedido], !!idPedido);

  const [clientes, productos] = base.data || [[], []];
  const info = infoQ.data;
  const detalles = info ? info.detalles : [];
  const esCambio = tipo.startsWith("CAMBIO");
  const errorCarga = error || base.error || pedidos.error || infoQ.error;

  // Variantes válidas para un cambio: mismo grupo (mismo padre), activas y distintas del original.
  const variantes = (idProducto) => {
    const b = productos.find((p) => p.id_producto === idProducto);
    return b ? productos.filter((p) => p.activo && p.id_producto !== idProducto && raiz(p) === raiz(b)) : [];
  };

  const cambiarCliente = (v) => { setIdCliente(v); setIdPedido(""); setLineas({}); setError(""); };
  const cambiarPedido = (v) => { setIdPedido(v); setLineas({}); setError(""); };
  const setLinea = (i, parche) => setLineas((ls) => ({ ...ls, [i]: { marcada: false, cantidad: 1, nuevo: "", ...ls[i], ...parche } }));

  const onSubmit = async (ev) => {
    ev.preventDefault();
    setError("");
    const marcadas = detalles.map((l, i) => [l, i]).filter(([, i]) => lineas[i]?.marcada);
    if (!marcadas.length) return setError("Marca al menos una prenda a devolver.");
    if (!tipo || !motivo) return setError("Elige el tipo y el motivo.");
    const items = [];
    for (const [l, i] of marcadas) {
      const q = Number(lineas[i].cantidad);
      if (!Number.isInteger(q) || q < 1 || q > l.cantidad_devolvible) return setError(`La cantidad de ${prod(l.Producto)} debe estar entre 1 y ${l.cantidad_devolvible}.`);
      const d = { id_detalle_pedido: l.id_detalle_pedido, cantidad: q };
      if (esCambio) {
        if (!lineas[i].nuevo) return setError(`Elige por qué prenda se cambia ${prod(l.Producto)}.`);
        d.id_producto_nuevo = Number(lineas[i].nuevo);
      }
      items.push(d);
    }
    setEnviando(true);
    try {
      const r = await devolucionesService.crear({ id_pedido: info.id_pedido, id_cliente: info.id_cliente, tipo, motivo, observacion: obs.trim() || undefined, detalles: items });
      aviso(`Solicitud #${r.devolucion.id_devolucion} registrada.`);
      navigate("/devolucion/" + r.devolucion.id_devolucion);
    } catch (e) {
      setError(e.message); setEnviando(false);
    }
  };

  return (
    <>
      <button className="back" onClick={() => navigate("/")}>Volver al listado</button>
      <div className="head"><h1>Nueva solicitud</h1></div>
      <div className="stack">
        {!crea && <div className="card err">Tu puesto no puede registrar solicitudes: requiere CAJERO o ADMIN.</div>}
        <form className="card stack" onSubmit={onSubmit}>
          <label className="sm muted">Cliente
            <Select className="field" value={idCliente} onChange={(ev) => cambiarCliente(ev.target.value)}
              placeholder={base.loading ? "Cargando clientes…" : "Elige un cliente"}
              options={clientes.map((c) => [c.id_cliente, `${c.nombre} ${c.apellido}`])} />
          </label>
          <label className="sm muted">Pedido entregado
            <Select className="field" value={idPedido} onChange={(ev) => cambiarPedido(ev.target.value)}
              disabled={!idCliente || pedidos.loading || !(pedidos.data || []).length}
              placeholder={!idCliente ? "Primero elige un cliente" : pedidos.loading ? "Buscando pedidos…" : (pedidos.data || []).length ? "Elige un pedido" : "Este cliente no tiene pedidos entregados"}
              options={(pedidos.data || []).map((p) => [p.id_pedido, `Pedido ${p.id_pedido}, ${fecha(p.fecha_pedido)}, total ${Number(p.total).toFixed(2)}`])} />
          </label>

          {info && !info.permite_devolucion && <p className="err">{info.mensaje}</p>}
          {info && info.permite_devolucion && info.plazo_vence && (
            <p className="muted sm">Una sola solicitud por pedido. Plazo hasta el {fecha(info.plazo_vence)} ({info.horas_plazo} horas desde la entrega).</p>
          )}
          <div>
            {info && info.permite_devolucion && detalles.map((l, i) => (
              <LineaPrenda key={l.id_detalle_pedido ?? i} linea={l} estado={lineas[i]} esCambio={esCambio}
                variantes={variantes(l.id_producto)} onChange={(parche) => setLinea(i, parche)} />
            ))}
          </div>

          {info && info.permite_devolucion && detalles.length > 0 && (
            <div className="stack">
              <label className="sm muted">Tipo
                <Select className="field" value={tipo} onChange={(ev) => setTipo(ev.target.value)} placeholder="Elige el tipo" options={TIPOS.map((t) => [t, humanizar(t)])} />
              </label>
              <label className="sm muted">Motivo
                <Select className="field" value={motivo} onChange={(ev) => setMotivo(ev.target.value)} placeholder="Elige el motivo" options={MOTIVOS.map((t) => [t, humanizar(t)])} />
              </label>
              <textarea className="field" maxLength={255} placeholder="Observación (opcional)" value={obs} onChange={(ev) => setObs(ev.target.value)} />
            </div>
          )}
          <div className="err" role="alert">{errorCarga}</div>
          <div><button className="btn pri" disabled={enviando || !(crea && info && info.permite_devolucion && detalles.some((l) => l.cantidad_devolvible > 0))}>Registrar solicitud</button></div>
        </form>
      </div>
    </>
  );
}
