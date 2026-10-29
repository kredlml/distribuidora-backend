import { useEffect, useRef, useState } from "react";
import useFetch from "../hooks/useFetch";
import * as imagenesService from "../services/imagenesService";

/**
 * Foto de una prenda dentro de un formulario: Subir / Cambiar / Quitar foto (Cloudinary) y, como
 * alternativa, pegar un enlace. Deja el valor en un input oculto `name` para que el formulario lo lea.
 * Las fotos que se suben y al final no se guardan (se cambiaron o se canceló) se descartan al
 * cerrar: el backend solo borra las que ninguna prenda usa, así que la guardada nunca se pierde.
 */
export default function FotoPrenda({ value, onChange, name = "imagen_url" }) {
  const cfg = useFetch(() => imagenesService.config(), []);
  const habilitado = !!(cfg.data && cfg.data.habilitado);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState("");
  const [conEnlace, setConEnlace] = useState(false);
  const [rota, setRota] = useState(null); // URL cuya vista previa no cargó
  const archivo = useRef(null);
  const subidas = useRef([]); // URLs subidas en este formulario

  useEffect(() => () => { imagenesService.descartar(subidas.current); }, []);

  const elegir = () => { setError(""); archivo.current && archivo.current.click(); };
  const alElegir = async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = ""; // permite volver a elegir el mismo archivo
    if (!f) return;
    setError(""); setSubiendo(true);
    try {
      const url = await imagenesService.subir(f);
      // La subida anterior de este mismo formulario que se reemplaza ya no se necesita.
      const anterior = subidas.current.includes(value) ? value : null;
      subidas.current.push(url);
      onChange(url);
      if (anterior) imagenesService.descartar([anterior]);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubiendo(false);
    }
  };
  const quitar = () => {
    setError("");
    if (subidas.current.includes(value)) imagenesService.descartar([value]);
    onChange("");
  };

  return (
    <div className="foto-prenda">
      <span className="sm muted">Foto (se muestra en la tienda en línea)</span>
      <input type="hidden" name={name} value={value || ""} />
      <input ref={archivo} type="file" accept={imagenesService.TIPOS.join(",")} hidden onChange={alElegir} aria-label="Elegir foto de la prenda" />
      <div className="foto-fila">
        <div className="foto-vista">
          {value && rota !== value ? <img src={imagenesService.optimizada(value, 240)} alt="Foto de la prenda" onError={() => setRota(value)} />
            : <span className="muted sm">{value ? "No se pudo cargar la vista previa" : "Sin foto"}</span>}
        </div>
        <div className="foto-acciones">
          {habilitado && (
            <button type="button" className="btn mini" disabled={subiendo} onClick={elegir}>
              {subiendo ? "Subiendo…" : value ? "Cambiar foto" : "Subir foto"}
            </button>
          )}
          {value && <button type="button" className="btn mini bad" disabled={subiendo} onClick={quitar}>Quitar foto</button>}
          {!conEnlace && <button type="button" className="enlace sm" onClick={() => setConEnlace(true)}>{habilitado ? "o pegar un enlace" : "Pegar enlace de la imagen"}</button>}
          {habilitado && <span className="muted sm">JPG, PNG o WebP, hasta {cfg.data.max_mb} MB.</span>}
        </div>
      </div>
      {conEnlace && (
        <input className="field" type="url" maxLength={500} placeholder="https://..." aria-label="Enlace de la imagen"
          value={value || ""} onChange={(e) => onChange(e.target.value)} />
      )}
      <div className="err" role="alert">{error}</div>
    </div>
  );
}
