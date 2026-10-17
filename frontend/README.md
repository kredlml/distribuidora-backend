# Distribuidora · Frontend

React + Vite + React Router. Consume la API del backend.

## Uso
```bash
cp .env.example .env   # ajusta VITE_API_URL
npm install
npm run dev            # http://localhost:8081
npm run build
```

`VITE_API_URL` es la URL del backend. El backend debe incluir el origen del frontend en `CORS_ORIGIN`.

## Estructura
- `src/pages/<Pantalla>/` — una carpeta por pantalla (componente, subcomponentes y CSS propio)
- `src/components/` — componentes compartidos (Rail, Modal, Chip, Select...)
- `src/services/` — acceso a la API (`api.js` + un servicio por recurso)
- `src/context/` — sesión (Auth) y avisos (Toast)
- `src/hooks/`, `src/utils/`, `src/config/env.js`, `src/styles/`
