import { useState } from "react";

/** Foto de la prenda; si no tiene (o no carga) muestra un recuadro con la inicial. */
export default function Imagen({ src, alt, className = "" }) {
  // Se recuerda QUÉ url falló: al cambiar de variante con otra foto, se vuelve a intentar.
  const [fallida, setFallida] = useState(null);
  if (!src || fallida === src) {
    return <div className={"img ph " + className} role="img" aria-label={alt}><span>{(alt || "?").trim().charAt(0).toUpperCase()}</span></div>;
  }
  return <img className={"img " + className} src={src} alt={alt} loading="lazy" onError={() => setFallida(src)} />;
}
