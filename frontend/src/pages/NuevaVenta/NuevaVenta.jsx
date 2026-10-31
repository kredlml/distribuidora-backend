import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Cargando, ErrorCard } from "../../components/Estado";
import Select from "../../components/Select";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import useFetch from "../../hooks/useFetch";
import * as clientesService from "../../services/clientesService";
import * as inventarioService from "../../services/inventarioService";
import * as pedidosService from "../../services/pedidosService";
import * as productosService from "../../services/productosService";
import * as sucursalesService from "../../services/sucursalesService";
import { dinero, prod } from "../../utils/format";
import { puede } from "../../utils/permisos";
import ClienteDialog from "../Clientes/ClienteDialog";
import "../Pedidos/Pedidos.css";

/** Venta de mostrador: sucursal, cliente y prendas. Crea el pedido y abre el cobro. */
export default function NuevaVenta() {
  const { sesion, rol } = useAuth();
  const todas = puede(rol, "todasLasSucursales");
  const aviso = useToast();
  const navigate = useNavigate();
  const datos = useFetch(async () => {
    const [sucs, clientes, prods, stock] = await Promise.all([
      sucursalesService.listarOFallar(), clientesService.listar(), productosService.listar(), inventarioService.stockDisponible(),
    ]);
    // Cada empleado vende en su sucursal; el distrital elige cualquiera.
    const visibles = sucs.filter((s) => s.activo !== false && (todas || (sesion && s.id_sucursal === sesion.id_sucursal)));
    return { sucs: visibles, clientes: clientes.filter((c) => c.activo !== false), prods, stock };
  }, []);
  // Clienta registrada en otra sucursal: se busca por su correo exacto.
  const [correoOtra, setCorreoOtra] = useState("");
  const [buscandoOtra, setBuscandoOtra] = useState(false);
  const buscarEnOtra = async () => {
    setError(""); setBuscandoOtra(true);
    try {
      const [c] = await clientesService.buscarPorCorreo(correoOtra.trim());
      if (!c) setError("No hay ninguna clienta activa con ese correo. Revísalo o regístrala.");
      else { setClientesExtra((xs) => [c, ...xs]); setIdCliente(String(c.id_cliente)); setBuscaCliente(""); setCorreoOtra(""); }
    } catch (e) { setError(e.message); }
    finally { setBuscandoOtra(false); }
  };

  const [idSucursal, setIdSucursal] = useState(() => (sesion && sesion.id_sucursal ? String(sesion.id_sucursal) : ""));
  const [idCliente, setIdCliente] = useState("");
  const [buscaCliente, setBuscaCliente] = useState("");
  const [clientesExtra, setClientesExtra] = useState([]); // creados en esta pantalla
  const [nuevoCliente, setNuevoCliente] = useState(false);
  const [lineas, setLineas] = useState([]); // [{ id_producto, cantidad }]
  const [idProducto, setIdProducto] = useState("");
  const [cantidad, setCantidad] = useState("1");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  // Cupón de descuento: el servidor calcula el descuento (y avisa si no aplica).
  const [codigo, setCodigo] = useState("");
  const [cupon, setCupon] = useState("");
  const cot = useFetch(() => pedidosService.cotizar({ id_sucursal: Number(idSucursal) || undefined, detalles: lineas, cupon }),
    [cupon, JSON.stringify(lineas), idSucursal], !!cupon && lineas.length > 0);

  const d = datos.data;
  // La sucursal guardada solo vale si sigue activa en la lista (la del empleado pudo desactivarse).
  const sucursal = d && d.sucs.some((s) => String(s.id_sucursal) === idSucursal) ? idSucursal : "";
  // Stock disponible de cada prenda en la sucursal elegida.
  const disponible = useMemo(() => {
    if (!d || !sucursal) return {};
    return Object.fromEntries(d.stock.filter((s) => String(s.id_sucursal) === sucursal).map((s) => [s.id_producto, Number(s.stock_total)]));
  }, [d, sucursal]);

  if (datos.loading && !d) return <Cargando>Preparando la venta…</Cargando>;
  if (datos.error) return <ErrorCard message={datos.error} onRetry={datos.reload} />;

  const P = Object.fromEntries(d.prods.map((p) => [p.id_producto, p]));
  const enCarrito = (id) => lineas.filter((l) => l.id_producto === id).reduce((s, l) => s + l.cantidad, 0);
  const vendibles = d.prods.filter((p) => p.activo && (disponible[p.id_producto] || 0) - enCarrito(p.id_producto) > 0);
  const clientes = [...clientesExtra.filter((x) => !d.clientes.some((c) => c.id_cliente === x.id_cliente)), ...d.clientes];
  const texto = buscaCliente.trim().toLowerCase();
  const elegido = clientes.find((c) => String(c.id_cliente) === idCliente);
  // El cliente elegido siempre queda en la lista aunque la búsqueda no lo incluya: así lo que se ve
  // es exactamente a quién se le vende.
  const clientesFiltrados = clientes.filter((c) => c === elegido || !texto || `${c.nombre} ${c.apellido} ${c.email || ""} ${c.telefono || ""}`.toLowerCase().includes(texto));
  const subtotal = lineas.reduce((s, l) => s + l.cantidad * Number(P[l.id_producto].precio_unitario), 0);
  const cuponOk = !!cupon && cot.data && cot.data.cupon && !cot.loading;
  // Con un cupón aplicado no se vende hasta tener su cálculo vigente (si no, se cobraría sin descuento).
  const calculandoCupon = !!cupon && lineas.length > 0 && (cot.loading || !!cot.error);
  const total = cuponOk ? cot.data.total : subtotal;
  // Tras recargar (p.ej. otra caja vendió lo último), las líneas que superan el stock se marcan.
  const excedida = (l) => l.cantidad > (disponible[l.id_producto] || 0);
  const hayExcedidas = lineas.some(excedida);

  const cambiarSucursal = (v) => { setIdSucursal(v); setLineas([]); setIdProducto(""); setError(""); };
  const agregar = () => {
    setError("");
    const n = Number(cantidad), id = Number(idProducto);
    const libre = (disponible[id] || 0) - enCarrito(id);
    if (!id) return setError("Elige una prenda.");
    if (!Number.isInteger(n) || n < 1) return setError("La cantidad debe ser un entero mayor a 0.");
    if (n > libre) return setError(`Solo quedan ${libre} unidades de ${prod(P[id])} en esta sucursal.`);
    setLineas((ls) => (ls.some((l) => l.id_producto === id) ? ls.map((l) => (l.id_producto === id ? { ...l, cantidad: l.cantidad + n } : l)) : [...ls, { id_producto: id, cantidad: n }]));
    setIdProducto(""); setCantidad("1");
  };

  const vender = async (ev) => {
    ev.preventDefault();
    setError("");
    if (!sucursal) return setError("Elige la sucursal.");
    if (!elegido) return setError("Elige el cliente o regístralo.");
    if (!lineas.length) return setError("Agrega al menos una prenda.");
    if (hayExcedidas) return setError("Algunas prendas ya no tienen stock suficiente: ajusta las cantidades marcadas.");
    setEnviando(true);
    try {
      // email_cliente: con él el servidor acepta a una clienta de otra sucursal encontrada por correo.
      const r = await pedidosService.crear({ id_cliente: elegido.id_cliente, email_cliente: elegido.email || undefined, id_sucursal: Number(sucursal), detalles: lineas,
        cupon: cupon && !(cot.data && cot.data.cupon_error) ? cupon : undefined });
      aviso(`Pedido #${r.pedido.id_pedido} creado. Registra el pago.`);
      navigate(`/pedidos/${r.pedido.id_pedido}?cobrar=1`, { replace: true });
    } catch (e) {
      setError(e.message);
      setEnviando(false);
      datos.reload(); // el stock pudo cambiar
    }
  };

  return (
    <>
      <button className="back" onClick={() => navigate("/pedidos")}>← Pedidos</button>
      <div className="head"><div><h1>Nueva venta</h1><div className="muted sm">Venta en mostrador. El precio sale del catálogo y el stock se descuenta al crear el pedido.</div></div></div>
      <form className="stack" onSubmit={vender}>
        <section className="card stack">
          <h2>Sucursal y cliente</h2>
          {todas ? (
            <label className="sm muted">Sucursal
              <Select className="field" value={sucursal} onChange={(e) => cambiarSucursal(e.target.value)}
                placeholder={d.sucs.length ? "Elige la sucursal" : "No hay sucursales activas"} options={d.sucs.map((s) => [s.id_sucursal, s.nombre])} />
            </label>
          ) : d.sucs.length ? (
            <p className="sm">Sucursal: <b>{d.sucs[0].nombre}</b></p>
          ) : (
            <p className="err">Tu sucursal está inactiva o no tienes una asignada: no puedes registrar ventas.</p>
          )}
          <div className="grid2">
            <label className="sm muted">Buscar cliente<input className="field" value={buscaCliente} onChange={(e) => setBuscaCliente(e.target.value)} placeholder="Nombre, correo o teléfono" /></label>
            <label className="sm muted">Cliente
              <Select className="field" value={idCliente} onChange={(e) => setIdCliente(e.target.value)}
                placeholder={clientesFiltrados.length ? "Elige el cliente" : "Sin coincidencias"}
                options={clientesFiltrados.map((c) => [c.id_cliente, `${c.nombre} ${c.apellido}${c.email ? ` (${c.email})` : c.telefono ? ` (${c.telefono})` : ""}`])} />
            </label>
          </div>
          <div className="ctl">
            <button type="button" className="btn mini" onClick={() => setNuevoCliente(true)}>Registrar cliente nuevo</button>
            {!todas && (
              <span className="ctl otra-sucursal">
                <input className="field" type="text" inputMode="email" autoComplete="off" aria-label="Correo de una clienta de otra sucursal" placeholder="¿Es clienta de otra sucursal? Su correo"
                  value={correoOtra} onChange={(e) => setCorreoOtra(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (correoOtra.trim()) buscarEnOtra(); } }} />
                <button type="button" className="btn mini" disabled={buscandoOtra || !correoOtra.trim()} onClick={buscarEnOtra}>Buscar</button>
              </span>
            )}
          </div>
        </section>

        <section className="card">
          <h2>Prendas</h2>
          {!sucursal ? <p className="muted">Primero elige la sucursal: se vende de su stock.</p> : (
            <div className="agregar-linea">
              <label className="sm muted">Prenda
                <Select className="field" value={idProducto} onChange={(e) => setIdProducto(e.target.value)}
                  placeholder={vendibles.length ? "Elige una prenda con stock" : "No hay stock disponible en esta sucursal"}
                  options={vendibles.map((p) => [p.id_producto, `${prod(p)}, ${dinero(p.precio_unitario)} (hay ${(disponible[p.id_producto] || 0) - enCarrito(p.id_producto)})`])} />
              </label>
              <label className="sm muted">Cantidad<input className="field" type="number" min="1" step="1" value={cantidad} onChange={(e) => setCantidad(e.target.value)} /></label>
              <button type="button" className="btn" onClick={agregar} disabled={!idProducto}>Agregar</button>
            </div>
          )}
          <div className="lineas sec">
            {lineas.map((l) => {
              const p = P[l.id_producto];
              return (
                <div className="linea" key={l.id_producto}>
                  <span>{prod(p)}<br /><span className="muted sm">{l.cantidad} × {dinero(p.precio_unitario)}</span>
                    {excedida(l) && <><br /><span className="err sm">Ahora solo hay {disponible[l.id_producto] || 0} disponibles</span></>}</span>
                  <span className="muted sm">{l.cantidad} u.</span>
                  <span className="num">{dinero(l.cantidad * Number(p.precio_unitario))}</span>
                  <button type="button" className="btn mini bad" onClick={() => setLineas((ls) => ls.filter((x) => x.id_producto !== l.id_producto))}>Quitar</button>
                </div>
              );
            })}
          </div>
          <div className="agregar-linea sec">
            <label className="sm muted">Cupón de descuento
              <input className="field" value={codigo} maxLength={30} placeholder="Código (opcional)" onChange={(e) => setCodigo(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setCupon(codigo.trim()); } }} />
            </label>
            <button type="button" className="btn" disabled={!codigo.trim()} onClick={() => setCupon(codigo.trim())}>Aplicar</button>
            {cupon && <button type="button" className="btn" onClick={() => { setCupon(""); setCodigo(""); }}>Quitar</button>}
          </div>
          {cupon && cot.data && cot.data.cupon_error && <p className="err sm">{cot.data.cupon_error}</p>}
          {cupon && cot.error && <p className="err sm">{cot.error}</p>}
          {cuponOk && (
            <>
              <div className="fila-total sm"><span>Subtotal</span><span>{dinero(cot.data.subtotal)}</span></div>
              <div className="fila-total sm"><span>Descuento (cupón {cot.data.cupon.codigo})</span><span>−{dinero(cot.data.descuento)}</span></div>
            </>
          )}
          <div className="fila-total grande"><span>Total</span><span>{dinero(total)}</span></div>
        </section>

        <div className="err" role="alert">{error}</div>
        <div className="ctl">
          <button className="btn pri" disabled={enviando || !lineas.length || !elegido || hayExcedidas || calculandoCupon}>{enviando ? "Creando pedido…" : "Crear pedido y cobrar"}</button>
          {elegido && <span className="muted sm">Venta a {elegido.nombre} {elegido.apellido}, {dinero(total)}</span>}
        </div>
      </form>

      {nuevoCliente && (
        <ClienteDialog sucursalFija={sucursal ? Number(sucursal) : undefined} onClose={() => setNuevoCliente(false)}
          onDone={(c) => { setNuevoCliente(false); setClientesExtra((xs) => [c, ...xs]); setBuscaCliente(""); setIdCliente(String(c.id_cliente)); }} />
      )}
    </>
  );
}
