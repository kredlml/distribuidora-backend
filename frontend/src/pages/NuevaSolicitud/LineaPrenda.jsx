import Select from "../../components/Select";
import { prod } from "../../utils/format";

/** Una prenda del pedido: casilla, cantidad y (si es cambio) la prenda nueva. */
export default function LineaPrenda({ linea: l, estado, esCambio, variantes, onChange }) {
  const e = { marcada: false, cantidad: 1, nuevo: "", ...estado };
  return (
    <div className="item">
      <label className="chk">
        <input type="checkbox" checked={e.marcada} disabled={!l.cantidad_devolvible} onChange={(ev) => onChange({ marcada: ev.target.checked })} />
        <span>
          {prod(l.Producto)}<br />
          <span className="muted sm">Comprado {l.cantidad_comprada}, ya solicitado {l.cantidad_solicitada}, por devolver {l.cantidad_devolvible}</span>
        </span>
      </label>
      <div className="ctl">
        {e.marcada && (
          <input className="pill qty" type="number" min="1" max={l.cantidad_devolvible} aria-label="Cantidad"
            value={e.cantidad} onChange={(ev) => onChange({ cantidad: ev.target.value })} />
        )}
        {e.marcada && esCambio && (
          <Select className="pill" aria-label="Producto nuevo" value={e.nuevo} onChange={(ev) => onChange({ nuevo: ev.target.value })}
            placeholder={variantes.length ? "Cambiar por…" : "Sin variantes registradas"}
            options={variantes.map((p) => [p.id_producto, prod(p)])} />
        )}
      </div>
    </div>
  );
}
