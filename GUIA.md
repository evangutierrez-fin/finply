# Guía rápida de Finply

Comandos de terminal, cómo iniciarlo (Mac y Windows) y cómo compartirlo.
Para la documentación completa (API, diseño, estructura), ve el [README](README.md).

Finply funciona igual en **Mac, Windows y Linux**: es Node.js puro, sin
dependencias nativas, sin Docker y sin servicios externos.

---

## 1 · Requisitos (cualquier sistema)

- **Node.js 23.6 o superior** — descárgalo de <https://nodejs.org>
  (la versión **LTS** actual ya lo cumple). En Windows, el instalador `.msi`
  con todo por defecto; en Mac, el `.pkg` o `brew install node`.

Compruébalo:

```bash
node -v
```

## 2 · Todos los comandos

Son **idénticos en Mac (Terminal) y Windows (PowerShell)**. Primero entra a la
carpeta del proyecto:

```bash
cd finply
```

(en Mac será la ruta donde la guardaste; en Windows, algo como
`cd C:\Users\Nombre\finply`)

| Comando | Qué hace | Cuándo usarlo |
|---|---|---|
| `npm install` | Instala las dependencias | Solo la primera vez (o tras actualizar) |
| `npm run dev` | Modo desarrollo → **http://localhost:5173** | El uso de todos los días |
| `npm run build` | Verifica tipos y compila el frontend a `dist/` | Una vez, antes de `npm start` |
| `npm start` | Modo producción: un solo servidor → **http://localhost:4321** | Uso "instalado", más ligero |
| `npm run seed` | Llena el libro con datos de ejemplo | Para probar la app ⚠️ borra lo que haya |
| `npm run reset` | Deja un libro en blanco | Para empezar tus datos reales ⚠️ borra lo que haya |
| `npm run typecheck` | Solo revisa tipos de TypeScript | Al programar |

Para detener la app: `Ctrl + C` en la terminal.

### El arranque típico

```bash
npm install
```

```bash
npm run dev
```

…y abre <http://localhost:5173>. Puedes correr `npm run seed` antes para
conocerla con datos de ejemplo, y `npm run reset` cuando empieces en serio.

### Tus datos

Todo tu libro vive en **un solo archivo**: `data/finply.db` (se crea solo al
primer arranque). No sale de tu máquina.

- **Respaldo**: copia ese archivo a un USB o tu nube personal.
- **Restaurar**: vuelve a ponerlo en `data/` con el mismo nombre.
- Está en `.gitignore`: **jamás se sube al repositorio**. Compartes el código,
  nunca tus finanzas.

## 3 · Compartirlo con familiares y amigos (open source)

Finply es tuyo bajo licencia **MIT** (archivo `LICENSE`): cualquiera puede
usarlo, estudiarlo, modificarlo y redistribuirlo, gratis. Cada persona que lo
instale tiene **su propio libro, local y privado** — nada se comparte entre
instalaciones.

### Paso 1 (tú, en tu Mac) — publicarlo en GitHub

El repositorio git ya está inicializado; falta el primer commit y subirlo:

```bash
cd finply && git add . && git commit -m "Finply v0.2.0 — libro de finanzas open source"
```

Con la CLI de GitHub (`gh auth login` la primera vez):

```bash
gh repo create finply --public --source . --push
```

O a mano: crea el repo vacío en <https://github.com/new> y luego:

```bash
git remote add origin https://github.com/TU-USUARIO/finply.git && git push -u origin main
```

Sugerencia: agrega al repo los *topics* `finanzas-personales`, `react`,
`sqlite`, `español`.

**Alternativa sin GitHub** — un ZIP limpio (sin dependencias ni tus datos)
desde tu Mac:

```bash
cd finply && zip -r ~/Desktop/finply.zip . -x "node_modules/*" -x "data/*" -x "dist/*" -x ".git/*"
```

### Paso 2 (ellos, en Windows) — instalarlo

Esto es lo que le mandas a tu familiar junto con el enlace. Cinco minutos:

1. **Instala Node.js**: <https://nodejs.org> → botón verde (LTS) → siguiente,
   siguiente, finalizar.
2. **Descarga Finply**: en la página del repo, botón verde **Code →
   Download ZIP** (no necesitan saber git) y descomprímelo donde quieran,
   por ejemplo en `Documentos\finply`.
3. **Abre una terminal en esa carpeta**: entra a la carpeta en el Explorador,
   clic derecho en un espacio vacío → **"Abrir en Terminal"** (o escribe
   `powershell` en la barra de dirección del Explorador y Enter).
4. **Instala y arranca**:

```bash
npm install
```

```bash
npm run dev
```

5. Abre <http://localhost:5173> en el navegador. Listo: su propio Finply,
   con su propio libro vacío (o `npm run seed` si quieren jugar primero con
   datos de ejemplo).

> **Si PowerShell se queja al correr `npm`** ("la ejecución de scripts está
> deshabilitada"), es una protección de Windows. Dos salidas: usar la terminal
> **Símbolo del sistema (cmd)** en lugar de PowerShell, o ejecutar una sola vez:
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

Sus datos quedan en `data\finply.db` dentro de su carpeta, solo en su compu.

### Extra — enseñarla en tu casa (misma red Wi-Fi)

Para presumirla desde un celular u otra compu de tu red, en tu Mac:

```bash
npm run build && npm start
```

y comparte `http://TU-IP-LOCAL:4321` (tu IP sale con `ipconfig getifaddr en0`).
Ojo: verían **tu** libro — esto es para demostrar la app, no para que cada
quien lleve sus cuentas.

---

**Resumen de 10 segundos**: Node LTS + `npm install` + `npm run dev`, igual en
Mac y Windows. Tu respaldo es `data/finply.db`. Para compartir: GitHub público
y que cada quien descargue el ZIP — cada persona tendrá su propio libro. 📗
