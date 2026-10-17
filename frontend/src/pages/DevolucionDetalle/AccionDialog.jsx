import { useState } from "react";
import Modal from "../../components/Modal";
import { useToast } from "../../context/ToastContext";
import * as devolucionesService from "../../services/devolucionesService";
import { ACCION } from "../../utils/constants";
import { prod } from "../../utils/format";

/** Diálogo de confirmación para una acción sobre la devolución (aprobar, recibir, revisar...). */
export default function AccionDialog({ accion, devolucion: d, onClose, onDone }) {
  const A = ACCION[accion];
  const aviso = useToast();
  const [enviando, setEnviando] = useState(false);

  const onSubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target), body = {}, obs = (fd.get("observacion") || "").trim();
    if (obs) body.observacion = obs;
    if (accion === "revisar") {
      body.aceptar = fd.get("aceptar") === "1";
      body.detalles = d.DetalleDevolucions.map((x) => ({ id_detalle_devolucion: x.id_detalle_devolucion, resultado_revision: fd.get("r_" + x.id_detalle_devolucion) }));
    }
    setEnviando(true);
    try {
      await devolucionesService.ejecutarAccion(d.id_devolucion, accion, body);
      aviso(`Devolución #${d.id_devolucion}: ${A.ok}.`);
      onDone();
    } catch (e) {
      setEnviando(false);
      aviso(e.message, true);
    }
  };

  return (
    <Modal onClose={onClose}>
      <form onSubmit={onSubmit}>
        <h1>{A.titulo}</h1>
        <p className="muted">{A.texto}</p>
        {accion === "revisar" && (
          <>
            <div className="stack">
              {d.DetalleDevolucions.map((x) => (
                <label key={x.id_detalle_devolucion} className="sm muted">
                  {prod(x.Producto)}, {x.cantidad} u.
                  <select className="pill" name={"r_" + x.id_detalle_devolucion}>
                    <option value="BUEN_ESTADO">Buen estado</option>
                    <option value="DANADO">Dañado</option>
                    <option value="DEFECTUOSO">Defectuoso</option>
                  </select>
                </label>
              ))}
            </div>
            <div className="radios">
              <label><input type="radio" name="aceptar" value="1" defaultChecked /> Aceptar devolución</label>
              <label><input type="radio" name="aceptar" value="0" /> Rechazar</label>
            </div>
          </>
        )}
        {A.obs && <textarea className="field" name="observacion" maxLength={255} placeholder="Observación (opcional)" />}
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn pri" disabled={enviando}>{A.boton}</button>
        </div>
      </form>
    </Modal>
  );
}
