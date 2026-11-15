# OpenSep

OpenSep es una aplicación web gratuita y autoalojada para separar canciones y audios en pistas independientes. Está inspirada en el flujo de trabajo de MVSEP, pero no utiliza su código, sus cuentas, sus modelos privados ni servicios de pago.

Todo el procesamiento se realiza en tu propia computadora mediante [Demucs](https://github.com/facebookresearch/demucs) y [AudioSep](https://github.com/Audio-AGI/AudioSep).

## Funciones principales

- Subida de un archivo, importación desde una URL HTTPS y procesamiento por lotes.
- Cola persistente de trabajos con progreso, cancelación e historial.
- Descarga de pistas individuales o de todos los resultados en un archivo ZIP.
- Salida en MP3, WAV de 16 o 32 bits, FLAC de 16 o 24 bits y M4A.
- Base de datos SQLite local, creada automáticamente.
- Separación con Demucs:
  - Voz e instrumental.
  - Voz, batería, bajo y otros instrumentos.
  - Voz, batería, bajo, guitarra, piano y otros instrumentos.
  - Extracción individual de batería, bajo, guitarra, piano u otros.
- Separación dirigida con AudioSep:
  - Percusión.
  - Trompeta.
  - Teclados.
  - Sintetizador.
  - Violín.
  - Guitarra acústica.
- No requiere registro, suscripción ni API de pago.

## Requisitos

### Instalación automática en Windows

- Windows 10 u 11 de 64 bits.
- Conexión a Internet durante la instalación y la primera descarga de modelos.
- `winget`, incluido normalmente con **Instalador de aplicaciones** de Microsoft.
- Al menos 10 GB de espacio libre; se recomiendan 15 GB.
- 8 GB de memoria RAM como mínimo; 16 GB recomendados.

El instalador prepara automáticamente:

- Node.js LTS.
- Corepack y pnpm para administrar el monorepo.
- Python 3.11.
- FFmpeg y FFprobe.
- Dependencias JavaScript y TypeScript.
- Entorno Python `.venv` con Demucs, PyTorch, TorchAudio y NumPy.
- Entorno Python independiente `.audiosep-venv` para AudioSep.
- Código y checkpoint de AudioSep, de aproximadamente 1.3 GB.

Demucs descarga sus modelos la primera vez que se utiliza cada modelo. AudioSep también puede descargar componentes adicionales de CLAP durante el primer procesamiento.

## Instalación automática recomendada

### 1. Descargar el proyecto

Descarga el repositorio como ZIP desde GitHub y descomprímelo, o clónalo:

```powershell
git clone URL-DE-TU-REPOSITORIO
cd mvsep
```

### 2. Ejecutar el instalador

Haz doble clic en:

```text
Instalar-OpenSep.cmd
```

También puedes ejecutarlo desde PowerShell:

```powershell
.\Instalar-OpenSep.cmd
```

El proceso puede tardar porque descarga Python, FFmpeg, PyTorch y los modelos. No cierres la ventana hasta ver el mensaje `Instalación terminada`.

### 3. Iniciar OpenSep

Después de instalar, haz doble clic en:

```text
Iniciar-OpenSep.cmd
```

El iniciador levanta la web, la API y el procesador de trabajos, y abre automáticamente:

```text
http://127.0.0.1:5173
```

La API funciona en:

```text
http://127.0.0.1:8787
```

Para detener completamente la aplicación, vuelve a la ventana de terminal y presiona `Ctrl + C`.

## Inicio desde una terminal

No necesitas instalar `pnpm` globalmente. Los comandos npm del proyecto invocan pnpm mediante Corepack.

```powershell
cd D:\PROYECTO\mvsep
npm run dev
```

Si todavía no instalaste las dependencias:

```powershell
corepack pnpm install
npm run dev
```

## Instalación manual

Utiliza esta opción si no tienes `winget` o prefieres instalar cada dependencia por separado.

### 1. Instalar programas del sistema

Instala:

- Node.js LTS 22 o posterior.
- Python 3.11 de 64 bits.
- FFmpeg con FFprobe.
- Git, únicamente si vas a clonar el repositorio.

Comprueba la instalación:

```powershell
node --version
npm --version
py -3.11 --version
ffmpeg -version
ffprobe -version
```

### 2. Instalar las dependencias web

Desde la carpeta principal:

```powershell
corepack pnpm install
```

### 3. Instalar Demucs

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r .\worker\requirements.txt
```

### 4. Instalar AudioSep

La forma más segura de preparar AudioSep, su entorno separado y verificar el SHA-256 del checkpoint es ejecutar:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1
```

El instalador guarda AudioSep en `vendor\AudioSep` y su entorno en `.audiosep-venv`.

### 5. Ejecutar

```powershell
npm run dev
```

## Cómo utilizar la aplicación

1. Abre `http://127.0.0.1:5173`.
2. Selecciona **Tipo de separación**.
3. Busca o filtra el modelo por categoría.
4. Elige el formato de salida.
5. Sube un audio, pega una URL HTTPS o selecciona varios archivos.
6. Inicia el trabajo y espera a que llegue al 100 %.
7. Descarga las pistas individuales o el ZIP completo.

Los perfiles de AudioSep producen el instrumento solicitado y una segunda pista con el resto del audio. El tiempo depende de la duración del archivo y del procesador; en CPU puede ser considerablemente más lento que la duración original.

## Base de datos y archivos generados

No debes instalar MySQL, PostgreSQL ni ningún servidor de base de datos. OpenSep utiliza SQLite incluido en Node.js.

Al iniciar la aplicación se crea automáticamente:

```text
data/opensep.sqlite
```

Dentro de `data` también se guardan temporalmente las entradas, pistas generadas y archivos descargables. Los trabajos terminados se conservan durante 24 horas de forma predeterminada.

La carpeta `data` está excluida de Git para no publicar audios ni información local. Si deseas reiniciar todos los trabajos, detén OpenSep y elimina manualmente la carpeta `data`. Esta operación borra el historial y los resultados locales.

## Estructura del proyecto

```text
apps/
  api/                 API HTTP y descargas
  runner/              Cola y ejecución de separaciones
  web/                 Interfaz React + Vite
packages/
  contracts/           Tipos, perfiles y validaciones compartidas
  server-core/         Configuración, SQLite y lógica del servidor
worker/                 Procesador Python de Demucs y adaptador AudioSep
scripts/                Instalador de Windows
vendor/AudioSep/        AudioSep descargado; no se sube a Git
data/                   Base de datos y resultados; no se sube a Git
Instalar-OpenSep.cmd    Instalación automática
Iniciar-OpenSep.cmd     Inicio automático
```

## Configuración avanzada

La aplicación acepta las siguientes variables de entorno:

| Variable | Valor predeterminado | Función |
|---|---:|---|
| `OPENSEP_HOST` | `127.0.0.1` | Dirección donde escucha la API. |
| `OPENSEP_API_PORT` | `8787` | Puerto de la API. |
| `OPENSEP_DATA_DIR` | `./data` | Carpeta de base de datos y trabajos. |
| `OPENSEP_PUBLIC_URL` | `http://127.0.0.1:8787` | URL pública de la API. |
| `OPENSEP_ALLOWED_ORIGINS` | Web local | Orígenes permitidos por CORS, separados por comas. |
| `OPENSEP_MAX_UPLOAD_BYTES` | `1048576000` | Tamaño máximo de una subida. |
| `OPENSEP_MAX_REMOTE_BYTES` | `1048576000` | Tamaño máximo de una importación remota. |
| `OPENSEP_MAX_BATCH_FILES` | `20` | Cantidad máxima de archivos por lote. |
| `OPENSEP_MAX_BATCH_BYTES` | `3221225472` | Tamaño total máximo del lote. |
| `OPENSEP_JOB_RETENTION_HOURS` | `24` | Horas de conservación de trabajos. |
| `OPENSEP_RUNNER_CONCURRENCY` | `1` | Trabajos procesados simultáneamente. |
| `OPENSEP_PYTHON` | `.venv` o `python` | Ejecutable Python de Demucs. |
| `OPENSEP_FFMPEG` | `ffmpeg` | Ruta o comando de FFmpeg. |
| `OPENSEP_FFPROBE` | `ffprobe` | Ruta o comando de FFprobe. |
| `OPENSEP_AUDIOSEP_PYTHON` | `.audiosep-venv/.../python.exe` | Python de AudioSep. |
| `OPENSEP_AUDIOSEP_ROOT` | `./vendor/AudioSep` | Carpeta del código y checkpoint de AudioSep. |

Ejemplo temporal en PowerShell:

```powershell
$env:OPENSEP_API_PORT = "9000"
$env:OPENSEP_JOB_RETENTION_HOURS = "48"
npm run dev
```

El archivo `.env.example` sirve como referencia. Actualmente las variables deben definirse en la terminal o en el entorno de Windows antes de iniciar OpenSep.

## Comandos disponibles

| Comando | Descripción |
|---|---|
| `npm run dev` | Inicia web, API y runner en modo desarrollo. |
| `npm run build` | Comprueba TypeScript y genera la web optimizada. |
| `npm run typecheck` | Comprueba los tipos sin generar archivos. |
| `npm test` | Ejecuta las pruebas automatizadas. |
| `npm start` | Inicia solamente la API; no sustituye al iniciador completo. |

## Solución de problemas

### `pnpm no se reconoce como un comando`

Utiliza:

```powershell
npm run dev
```

Los scripts usan Corepack internamente. Si Corepack todavía no descargó pnpm:

```powershell
corepack pnpm install
```

### `node`, `py` o `ffmpeg` no se reconoce

Cierra y abre nuevamente PowerShell después de ejecutar el instalador. Si continúa, vuelve a ejecutar `Instalar-OpenSep.cmd` y revisa que `winget` haya terminado correctamente.

### El procesador aparece como no disponible

Comprueba que existan:

```text
.venv\Scripts\python.exe
.audiosep-venv\Scripts\python.exe
vendor\AudioSep\pipeline.py
vendor\AudioSep\checkpoint\audiosep_base_4M_steps.ckpt
```

Reinicia OpenSep y pulsa **Volver a comprobar procesador** en la interfaz.

### El puerto está ocupado

Detén la otra aplicación o cambia el puerto antes de iniciar:

```powershell
$env:OPENSEP_API_PORT = "9000"
npm run dev
```

Si cambias direcciones o puertos, actualiza también `OPENSEP_PUBLIC_URL` y `OPENSEP_ALLOWED_ORIGINS`.

### El procesamiento es lento

La separación mediante inteligencia artificial consume mucha CPU y memoria. Utiliza archivos cortos para comprobar la instalación, cierra programas pesados y mantén la concurrencia en `1`. La instalación automática de AudioSep está preparada para funcionar en CPU y prioriza compatibilidad.

### Una descarga de modelo se interrumpió

Verifica Internet y espacio libre, y vuelve a ejecutar `Instalar-OpenSep.cmd`. El checkpoint de AudioSep se valida mediante SHA-256 para evitar utilizar un archivo incompleto o alterado.

## Subir el proyecto a GitHub

Los modelos, entornos virtuales, dependencias, audios, resultados, base de datos y secretos ya están excluidos mediante `.gitignore`.

```powershell
git init
git add .
git commit -m "Primera versión de OpenSep"
git branch -M main
git remote add origin URL-DE-TU-REPOSITORIO.git
git push -u origin main
```

Cuando alguien clone el repositorio deberá ejecutar `Instalar-OpenSep.cmd`, porque los modelos y las dependencias pesadas no se almacenan en GitHub.

## Seguridad y privacidad

- Los archivos se procesan localmente y no se envían a MVSEP ni a una API de pago.
- Las importaciones remotas aceptan únicamente HTTPS y bloquean direcciones privadas o reservadas.
- Los nombres de archivo internos son generados por OpenSep.
- Los procesos externos se ejecutan sin construir comandos mediante un shell.
- No subas `.env`, bases de datos, audios ni checkpoints al repositorio.

## Licencias

Revisa las licencias de OpenSep y de cada dependencia antes de redistribuir una instalación que ya incluya modelos. Demucs, AudioSep, PyTorch y los checkpoints pueden tener términos de uso propios. Este repositorio no concede derechos sobre canciones ni audios procesados.
