import { useState } from "react";
import Select from "../../components/Select";
import useFetch from "../../hooks/useFetch";
import * as inventarioService from "../../services/inventarioService";
import * as pedidosService from "../../services/pedidosService";
import * as productosService from "../../services/productosService";
import { dinero, prod } from "../../utils/format";

/** Agrega una prenda a un pedido PENDIENTE (precio del catálogo, stock de la sucursal del pedido). */
export default function AgregarLinea({ pedido, onAgregada }) {
  const [idProducto, setIdProducto] = useState("");
  const [cantidad, setCantidad] = useState("1");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const datos = useFetch(async () => {
    const [prods, stock] = await Promise.all([productosService.listar(), inventarioService.stockDisponible()]);
    const disp = Object.fromEntries(stock.filter((s) => s.id_sucursal === pedido.id_sucursal).map((s) => [s.id_producto, Number(s.stock_total)]));
    return prods.filter((x) => x.activo && disp[x.id_producto] > 0).map((x) => ({ ...x, disponible: disp[x.id_producto] }));
  }, [pedido.id_sucursal, pedido.total]);

  const agregar = async (ev) => {
    ev.preventDefault();
    setError(""); setEnviando(true);
    try {
      await pedidosService.agregarLinea(pedido.id_pedido, Number(idProducto), Number(cantidad));
      setIdProducto(""); setCantidad("1");
      onAgregada();
    } catch (e) {
      setError(e.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form className="sec" onSubmit={agregar}>
      <div className="agregar-linea">
        <label className="sm muted">Agregar prenda
          <Select className="field" required value={idProducto} onChange={(e) => setIdProducto(e.target.value)}
            placeholder={datos.loading ? "Cargando…" : (datos.data || []).length ? "Elige una prenda con stock" : "Sin stock disponible en esta sucursal"}
            options={(datos.data || []).map((x) => [x.id_producto, `${prod(x)}, ${dinero(x.precio_unitario)} (hay ${x.disponible})`])} />
        </label>
        <label className="sm muted">Cantidad<input className="field" type="number" min="1" step="1" required value={cantidad} onChange={(e) => setCantidad(e.target.value)} /></label>
        <button className="btn" disabled={enviando || !idProducto}>Agregar</button>
      </div>
      <div className="err" role="alert">{error || datos.error}</div>
    </form>
  );
}
