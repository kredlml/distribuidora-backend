import { useState } from "react";
import Modal from "../../components/Modal";
import Select from "../../components/Select";
import { useToast } from "../../context/ToastContext";
import useSubmit from "../../hooks/useSubmit";
import * as inventarioService from "../../services/inventarioService";
import { MOTIVOS_AJUSTE } from "../../utils/constants";
import { humanizar, prod } from "../../utils/format";

/**
 * Baja de stock de varias filas a la vez. Por defecto cada fila queda en 0 (eliminar ese stock);
 * se puede escribir otra cantidad menor para bajar solo una parte. Cada baja queda en Trazabilidad.
 */
export default function AjusteDialog({ sucursal, filas, onClose, onDone }) {
  const aviso = useToast();
  const [nuevas, setNuevas] = useState(() => Object.fromEntries(filas.map((x) => [x.id_inventario, "0"])));
  const [motivo, setMotivo] = useState("");

  const valor = (x) => Number(nuevas[x.id_inventario]);
  const valida = (x) => nuevas[x.id_inventario] !== "" && Number.isInteger(valor(x)) && valor(x) >= 0 && valor(x) < x.cantidad;
  const todasValidas = filas.every(valida);
  const unidades = filas.reduce((s, x) => s + (valida(x) ? x.cantidad - valor(x) : 0), 0);

  const { error, enviando, onSubmit } = useSubmit(async (fd) => {
    if (!todasValidas) throw new Error("Cada cantidad nueva debe ser un entero desde 0 hasta una unidad menos que la actual.");
    const r = await inventarioService.ajustar({
      id_sucursal: sucursal.id_sucursal, motivo, observacion: fd.get("observacion").trim() || undefined,
      ajustes: filas.map((x) => ({ id_inventario: x.id_inventario, cantidad_actual: x.cantidad, cantidad_nueva: valor(x) })),
    });
    aviso(r.message);
    onDone();
  });

  return (
    <Modal onClose={onClose}>
      <form onSubmit={onSubmit}>
        <h1>Dar de baja stock</h1>
        <p className="muted sm">{sucursal.nombre}. Deja 0 para eliminar todo el stock de la fila o escribe cuántas unidades deben quedar.</p>
        <div className="ajuste-lista">
          {filas.map((x) => (
            <div className="ajuste-fila" key={x.id_inventario}>
              <span>{prod(x.prenda)}<br /><span className="muted sm">{x.lote || "Sin lote"}, {humanizar(x.estado)}, hay {x.cantidad}</span></span>
              <label className="sm muted">Quedan
                <input className={`field qty ${valida(x) ? "" : "mal"}`} type="number" min="0" max={x.cantidad - 1} step="1" required
                  aria-label={`Unidades que quedan de ${prod(x.prenda)}, ${x.lote || "sin lote"}, ${humanizar(x.estado)} (hay ${x.cantidad})`} aria-invalid={!valida(x)}
                  value={nuevas[x.id_inventario]} onChange={(e) => setNuevas({ ...nuevas, [x.id_inventario]: e.target.value })} />
              </label>
            </div>
          ))}
        </div>
        <label className="sm muted">Motivo
          <Select className="field" required value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Elige el motivo" options={MOTIVOS_AJUSTE} />
        </label>
        <label className="sm muted">Observación {motivo === "OTRO" ? "(obligatoria)" : "(opcional)"}
          <input className="field" name="observacion" maxLength={150} required={motivo === "OTRO"} placeholder="Ej.: conteo del 19/10, faltaban 3" />
        </label>
        <p className="sm">Se darán de baja <b>{unidades}</b> unidad{unidades === 1 ? "" : "es"} en {filas.length} fila{filas.length === 1 ? "" : "s"}. Queda registrado en Trazabilidad con tu nombre.</p>
        <div className="err" role="alert">{error}</div>
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn bad" disabled={enviando || !todasValidas || !motivo}>Confirmar baja</button>
        </div>
      </form>
    </Modal>
  );
}
