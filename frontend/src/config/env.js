// Única fuente de configuración: se define en .env (VITE_API_URL).
export const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:8080").replace(/\/+$/, "");
