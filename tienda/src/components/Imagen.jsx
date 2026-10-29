import { useState } from "react";

// Fotos de Cloudinary: se piden ya optimizadas (formato y calidad automáticos, ancho justo para
// donde se muestran). Los enlaces de otros sitios se usan tal cual.
const optimizada = (url, ancho) =>
  /^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\//.test(url)
    ? url.replace("/image/upload/", `/image/upload/f_auto,q_auto,c_limit,w_${ancho}/`)
    : url;

/** Foto de la prenda; si no tiene (o no carga) muestra un recuadro con la inicial. */
export default function Imagen({ src, alt, className = "", ancho = 600 }) {
  // Se recuerda QUÉ url falló: al cambiar de variante con otra foto, se vuelve a intentar.
  const [fallida, setFallida] = useState(null);
  if (!src || fallida === src) {
    return <div className={"img ph " + className} role="img" aria-label={alt}><span>{(alt || "?").trim().charAt(0).toUpperCase()}</span></div>;
  }
  return <img className={"img " + className} src={optimizada(src, ancho)} alt={alt} loading="lazy" onError={() => setFallida(src)} />;
}
