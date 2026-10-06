# Avatar Pro — JCOTRAINER
Generador de kit de marketing con IA para entrenadores personales.

## Estructura
```
avatarpro-netlify/
├── public/
│   ├── index.html              ← App completa (frontend)
│   └── admin/index.html        ← Panel para generar y administrar códigos de acceso
├── netlify/
│   └── functions/
│       ├── claude-proxy.js     ← Función serverless (guarda la API key, valida el código)
│       └── admin.js            ← Backend del panel de administración
├── lib/
│   └── codigos.js              ← Almacén de códigos de acceso (Netlify Blobs)
├── netlify.toml                ← Config de Netlify
├── package.json
└── .env.example
```

## Códigos de acceso

Los códigos se guardan en Netlify Blobs (store `codigos`), no en una variable de entorno. Para generar uno nuevo entra a `/admin` del sitio, ingresa la clave de administrador y escribe el nombre del alumno y los días de validez.

Variables relacionadas (marcadas como secret en Netlify):
- `ADMIN_ACCESS_KEY`: la clave para entrar al panel de administración de códigos (`/admin`).
- `ACCESS_CODES`: **ya no es la fuente de verdad.** Sólo se lee una vez, en el primer arranque después de cada despliegue, para sembrar en Blobs el código compartido que estuviera vigente en ese momento (con 30 días de vencimiento desde esa siembra). Puede quedar configurada sin uso, o borrarse una vez que ese código aparezca en el panel.

## Despliegue en Netlify

### Opción A — Arrastrar carpeta (más simple)
1. Ve a app.netlify.com → Add new site → Deploy manually
2. Arrastra la carpeta `avatarpro-netlify/` completa
3. En Site Settings → Environment variables → agrega:
   - Key: `ANTHROPIC_API_KEY`
   - Value: tu API key de Anthropic (sk-ant-...)
4. Trigger deploy → listo

### Opción B — Conectar con GitHub
1. Sube esta carpeta a un repositorio de GitHub
2. En Netlify → Add new site → Import from Git
3. Selecciona el repo, branch main
4. Build command: (vacío)
5. Publish directory: `public`
6. Agrega la variable `ANTHROPIC_API_KEY` en Environment variables
7. Deploy

## Desarrollo local
```bash
npm install
cp .env.example .env    # agrega tu API key en .env
npm run dev             # levanta Netlify Dev en localhost:8888
```

## Cómo funciona la seguridad
- El frontend llama a `/api/claude` (nunca a Anthropic directamente)
- Netlify redirige `/api/claude` → `/.netlify/functions/claude-proxy`
- La función serverless inyecta la API key desde variables de entorno
- La API key **nunca viaja al navegador del usuario**
