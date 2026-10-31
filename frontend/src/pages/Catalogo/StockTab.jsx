import { useState } from "react";
import ComprobanteDialog from "../../components/ComprobanteDialog";
import Select from "../../components/Select";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import useFetch from "../../hooks/useFetch";
import * as inventarioService from "../../services/inventarioService";
import * as proveedoresService from "../../services/proveedoresService";
import { INV_ESTADOS } from "../../utils/constants";
import { dinero, humanizar, prod } from "../../utils/format";
import { puede } from "../../utils/permisos";

let siguienteClave = 1;
const lineaVacia = () => ({ clave: siguienteClave++, id_producto: "", cantidad: "", estado: "DISPONIBLE", lote: "", costo: "" });
const entero = (v) => Number.isInteger(Number(v)) && Number(v) > 0;

/**
 * Ingreso de mercadería a una sucursal: una o varias prendas, de un proveedor (con su factura o
 * número de envío) o directo. Al registrarlo se genera el comprobante de entrada y se abre para
 * revisarlo o descargarlo en PDF.
 */
export default function StockTab({ prods, sucs, reload }) {
  const { sesion, rol } = useAuth();
  const aviso = useToast();
  // Cada sucursal ingresa stock solo en la suya; el distrital elige la sucursal.
  const todas = puede(rol, "todasLasSucursales");
  const propia = sesion && sesion.id_sucursal;
  const opciones = sucs.filter((x) => x.activo !== false && (todas || x.id_sucursal === propia));
  const provs = useFetch(() => proveedoresService.listar(), []);
  const activos = (provs.data || []).filter((p) => p.activo !== false);

  const [lineas, setLineas] = useState(() => [lineaVacia()]);
  const [proveedor, setProveedor] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [emitido, setEmitido] = useState(null);

  const cambiar = (clave, campo, valor) => setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, [campo]: valor } : l)));
  const quitar = (clave) => setLineas((ls) => (ls.length > 1 ? ls.filter((l) => l.clave !== clave) : ls));
  const unidades = lineas.reduce((s, l) => s + (entero(l.cantidad) ? Number(l.cantidad) : 0), 0);
  const valor = lineas.reduce((s, l) => s + (entero(l.cantidad) && l.costo !== "" && Number(l.costo) >= 0 ? Number(l.costo) * Number(l.cantidad) : 0), 0);
  const conCosto = lineas.some((l) => l.costo !== "");

  const enviar = async (ev) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const fd = new FormData(form);
    const malas = lineas.findIndex((l) => !l.id_producto || !entero(l.cantidad));
    if (malas >= 0) { setError(`Línea ${malas + 1}: elige la prenda y escribe una cantidad entera mayor que 0.`); return; }
    setError(""); setEnviando(true);
    try {
      const r = await inventarioService.ingresarMercaderia({
        id_sucursal: Number(todas ? fd.get("id_sucursal") : propia),
        id_proveedor: proveedor ? Number(proveedor) : null,
        documento_proveedor: proveedor ? (fd.get("documento_proveedor") || "").trim() || null : null,
        observacion: (fd.get("observacion") || "").trim() || null,
        lineas: lineas.map((l) => ({
          id_producto: Number(l.id_producto), cantidad: Number(l.cantidad), estado: l.estado,
          lote: l.lote.trim() || null, costo_unitario: l.costo === "" ? null : Number(l.costo),
        })),
      });
      aviso(r.message);
      setEmitido(r.comprobante);
      setLineas([lineaVacia()]); setProveedor(""); form.reset();
      reload();
    } catch (e) { setError(e.message); }
    setEnviando(false);
  };

  if (!todas && !propia) return <div className="card err">Tu cuenta no tiene sucursal asignada: pide al gerente distrital que te asigne una.</div>;

  return (
    <>
      <form className="card stack" onSubmit={enviar}>
        <h2>Ingresar stock</h2>
        <p className="muted sm">Registra la mercadería que llega a la sucursal. Cada ingreso genera un comprobante de entrada numerado (CE) que puedes descargar en PDF.</p>
        {todas ? (
          <label className="sm muted">Sucursal que recibe
            <Select className="field" name="id_sucursal" required placeholder={opciones.length ? "Elige la sucursal" : "No hay sucursales activas (actívalas en Sucursales)"}
              options={opciones.map((x) => [x.id_sucursal, x.nombre])} />
          </label>
        ) : (
          <p className="sm">Sucursal: <b>{(opciones[0] || {}).nombre || sesion.sucursal || `#${propia}`}</b></p>
        )}
        <div className="grid2">
          <label className="sm muted">Proveedor
            <select className="field" name="id_proveedor" value={proveedor} onChange={(e) => setProveedor(e.target.value)}>
              <option value="">Sin proveedor (inventario inicial u otro ingreso)</option>
              {activos.map((p) => <option key={p.id_proveedor} value={p.id_proveedor}>{p.nombre_empresa}</option>)}
            </select>
          </label>
          <label className="sm muted">Factura o número de envío del proveedor
            <input className="field" name="documento_proveedor" maxLength={60} disabled={!proveedor} placeholder={proveedor ? "Ej.: FAC-A-1001" : "Elige primero el proveedor"} />
          </label>
        </div>
        {provs.error && <p className="err sm">No se pudo cargar la lista de proveedores: {provs.error}</p>}

        <div className="lineas-ingreso" aria-label="Prendas que ingresan">
          {lineas.map((l, i) => (
            <div className="linea-ingreso" key={l.clave}>
              <label className="sm muted">Prenda {lineas.length > 1 ? i + 1 : ""}
                <Select className="field" required value={l.id_producto} onChange={(e) => cambiar(l.clave, "id_producto", e.target.value)} placeholder="Elige la prenda"
                  aria-label={`Prenda de la línea ${i + 1}`} options={prods.filter((p) => p.activo).map((p) => [p.id_producto, `#${p.id_producto} ${prod(p)}`])} />
              </label>
              <label className="sm muted">Cantidad
                <input className="field" type="number" step="1" min="1" max="100000" required aria-label={`Cantidad de la línea ${i + 1}`}
                  value={l.cantidad} onChange={(e) => cambiar(l.clave, "cantidad", e.target.value)} />
              </label>
              <label className="sm muted">Estado
                <select className="field" aria-label={`Estado de la línea ${i + 1}`} value={l.estado} onChange={(e) => cambiar(l.clave, "estado", e.target.value)}>
                  {INV_ESTADOS.map((e) => <option key={e} value={e}>{humanizar(e)}</option>)}
                </select>
              </label>
              <label className="sm muted">Lote
                <input className="field" maxLength={60} placeholder="Opcional" aria-label={`Lote de la línea ${i + 1}`} value={l.lote} onChange={(e) => cambiar(l.clave, "lote", e.target.value)} />
              </label>
              <label className="sm muted">Costo c/u (Q)
                <input className="field" type="number" step="0.01" min="0" placeholder="Opcional" aria-label={`Costo unitario de la línea ${i + 1}`}
                  value={l.costo} onChange={(e) => cambiar(l.clave, "costo", e.target.value)} />
              </label>
              <button type="button" className="btn mini" disabled={lineas.length === 1} onClick={() => quitar(l.clave)} aria-label={`Quitar la línea ${i + 1}`}>Quitar</button>
            </div>
          ))}
        </div>
        <div><button type="button" className="btn mini" disabled={lineas.length >= 100} onClick={() => setLineas((ls) => [...ls, lineaVacia()])}>Agregar otra prenda</button></div>

        <label className="sm muted">Observación (opcional)
          <input className="field" name="observacion" maxLength={200} placeholder="Ej.: pedido de temporada, llegó con 2 cajas" />
        </label>
        <p className="sm">Ingresan <b>{unidades}</b> unidad{unidades === 1 ? "" : "es"} en {lineas.length} línea{lineas.length === 1 ? "" : "s"}{conCosto ? <>, valor <b>{dinero(valor)}</b></> : ""}.</p>
        <div className="err" role="alert">{error}</div>
        <div><button className="btn pri" disabled={enviando}>{enviando ? "Registrando…" : "Registrar ingreso"}</button></div>
      </form>
      {emitido && <ComprobanteDialog comprobante={emitido} onClose={() => setEmitido(null)} />}
    </>
  );
}
