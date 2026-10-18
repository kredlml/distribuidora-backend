// Única fuente de configuración: se define en .env (ver .env.example).
export const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:8080").replace(/\/+$/, "");
export const STRIPE_PK = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "").trim();
