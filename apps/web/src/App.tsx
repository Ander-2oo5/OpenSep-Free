import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { Link, NavLink, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  outputFormats,
  profiles,
  type CapabilitiesResponse,
  type Job,
  type OutputFormat,
  type ProfileId,
} from "@opensep/contracts";
import { api, ApiClientError } from "./api.js";

const formatLabels: Readonly<Record<OutputFormat, string>> = {
  "mp3-320": "MP3 (320 kbps)",
  "wav-16": "WAV (sin comprimir, 16 bit)",
  "flac-16": "FLAC (sin pérdida, 16 bit)",
  m4a: "M4A (AAC, 256 kbps)",
  "wav-32": "WAV (flotante, 32 bit)",
  "flac-24": "FLAC (sin pérdida, 24 bit)",
};

function WaveLogo({ muted = false }: { readonly muted?: boolean }) {
  return (
    <span className={`brand ${muted ? "brand--muted" : ""}`} aria-label="OpenSep">
      <svg viewBox="0 0 72 42" aria-hidden="true">
        <path d="M4 33 18 8l13 25L44 8l11 20 13-20" />
      </svg>
      <span>OPENSEP</span>
    </span>
  );
}

function Shell() {
  const [dark, setDark] = useState(() => localStorage.getItem("opensep-theme") === "dark");
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("opensep-theme", dark ? "dark" : "light");
  }, [dark]);
  return (
    <div className="app-shell">
      <header className="site-header">
        <nav className="nav container" aria-label="Navegación principal">
          <Link to="/" className="logo-link"><WaveLogo /></Link>
          <div className="nav-links">
            <NavLink to="/">Inicio</NavLink>
            <NavLink to="/algorithms">Algoritmos</NavLink>
            <NavLink to="/plans">Planes</NavLink>
            <NavLink to="/demo">Demostración</NavLink>
            <NavLink to="/tools">Herramientas</NavLink>
          </div>
          <div className="nav-actions">
            <Link className="button button--primary button--small" to="/batch">Procesar lote</Link>
            <button className="icon-button" onClick={() => setDark((value) => !value)} aria-label={dark ? "Usar modo claro" : "Usar modo oscuro"}>
              {dark ? "☀" : "●"}
            </button>
          </div>
        </nav>
      </header>
      <main><RoutesView /></main>
      <Footer />
    </div>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div><WaveLogo muted /><p>Separación de audio local, abierta y sin créditos.</p><p className="fine-print">Tus archivos permanecen en tu instalación.</p></div>
        <div><h2>Producto</h2><Link to="/tools">Herramientas</Link><Link to="/algorithms">Modelos</Link><Link to="/demo">Demostraciones</Link></div>
        <div><h2>Procesar</h2><Link to="/">Carga local</Link><Link to="/remote">Carga remota</Link><Link to="/batch">Carga por lotes</Link></div>
        <div><h2>Proyecto</h2><a href="https://github.com/facebookresearch/demucs" target="_blank" rel="noreferrer">Demucs</a><Link to="/plans">Funciones gratuitas</Link><span>API local</span></div>
      </div>
    </footer>
  );
}

function RoutesView() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/home" element={<HomePage />} />
      <Route path="/remote" element={<RemotePage />} />
      <Route path="/batch" element={<BatchPage />} />
      <Route path="/batches/:id" element={<BatchDetailsPage />} />
      <Route path="/jobs/:id" element={<JobPage />} />
      <Route path="/tools" element={<ToolsPage />} />
      <Route path="/algorithms" element={<AlgorithmsPage />} />
      <Route path="/plans" element={<PlansPage />} />
      <Route path="/demo" element={<DemoPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

function useCapabilities() {
  const [data, setData] = useState<CapabilitiesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = async (force = false) => {
    setLoading(true);
    setError(null);
    try { setData(await api.capabilities(force)); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  return { data, loading, error, recheck: () => load(true) };
}

function errorMessage(reason: unknown): string {
  return reason instanceof ApiClientError || reason instanceof Error ? reason.message : "Ocurrió un error inesperado.";
}

function CapabilityNotice({ capabilities, loading, error, onRecheck }: {
  readonly capabilities: CapabilitiesResponse | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRecheck: () => Promise<void>;
}) {
  if (loading) return <div className="notice notice--neutral"><span className="spinner" /> Comprobando el procesador local…</div>;
  if (error) return <div className="notice notice--error">{error}<button onClick={() => void onRecheck()}>Reintentar</button></div>;
  if (capabilities?.processor) return <div className="notice notice--success"><strong>Procesador listo.</strong> Python, FFmpeg y Demucs están disponibles.</div>;
  const reason = capabilities?.capabilities[0]?.reason ?? "El procesador no está instalado.";
  return (
    <div className="notice notice--warning">
      <div><strong>Configura el procesamiento real</strong><span>{reason} La interfaz no fabricará resultados.</span></div>
      <button className="button button--outline button--small" onClick={() => void onRecheck()}>Revisar de nuevo</button>
    </div>
  );
}

function HeroHeading({ title, subtitle }: { readonly title: string; readonly subtitle: string }) {
  return <div className="hero-heading"><h1>{title}</h1><p>{subtitle}</p></div>;
}

function ProfileButton({ value, onChange, capabilities }: {
  readonly value: ProfileId;
  readonly onChange: (value: ProfileId) => void;
  readonly capabilities: CapabilitiesResponse | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("featured");
  const [showInformation, setShowInformation] = useState(false);
  const profile = profiles.find((item) => item.id === value)!;
  const categories = [
    ["featured", "✦ Destacados"], ["voice", "♩ Voz"], ["drums", "◉ Batería"], ["bass", "♬ Bajo"],
    ["piano", "▤ Piano"], ["guitar", "♬ Guitarra"], ["wind", "➤ Viento"], ["strings", "⌁ Cuerdas"],
    ["percussion", "◇ Percusión"], ["keys", "▦ Teclados"],
  ] as const;
  const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const visibleProfiles = profiles.filter((item) => {
    const matchesCategory = category === "featured" ? item.categories.includes("featured") : item.categories.includes(category);
    const haystack = normalize(`${item.name} ${item.description} ${item.stems.join(" ")}`);
    return matchesCategory && haystack.includes(normalize(query.trim()));
  });
  const groups = Array.from(new Set(visibleProfiles.map((item) => item.group)));
  const openDialog = () => {
    dialog.current?.showModal();
    setTimeout(() => searchInput.current?.focus(), 0);
  };
  return (
    <>
      <button type="button" className="profile-select" onClick={openDialog}>
        <span><strong>{profile.name}</strong><small>{profile.stems.join(", ")}</small></span><span aria-hidden="true">⌄</span>
      </button>
      <dialog ref={dialog} className="model-dialog" onClick={(event) => { if (event.target === dialog.current) dialog.current.close(); }}>
        <div className="dialog-panel">
          <div className="dialog-title"><div><h2>Elige el tipo de separación</h2><p>Modelos locales y gratuitos, sin créditos.</p></div><button className="icon-button" onClick={() => dialog.current?.close()} aria-label="Cerrar">×</button></div>
          <div className="model-toolbar">
            <input ref={searchInput} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar…" aria-label="Buscar tipo de separación" />
            <label className="info-toggle"><span>Mostrar información</span><input type="checkbox" checked={showInformation} onChange={(event) => setShowInformation(event.target.checked)} /><i /></label>
          </div>
          <div className="category-chips" aria-label="Categorías">{categories.map(([id, label]) => <button type="button" key={id} className={category === id ? "is-active" : ""} onClick={() => setCategory(id)}>{label}</button>)}</div>
          <div className="model-list">
            {groups.map((group) => <section className="model-group" key={group}><h3>{group}</h3>{visibleProfiles.filter((item) => item.group === group).map((item) => {
                const capability = capabilities?.capabilities.find((candidate) => candidate.id === item.id);
                const disabled = capability ? !capability.available : false;
                return <button type="button" key={item.id} disabled={disabled} title={disabled ? capability?.reason ?? "Procesador no disponible" : item.description} className={`model-option ${item.id === value ? "is-selected" : ""}`} onClick={() => { onChange(item.id); dialog.current?.close(); }}>
                  <span className="model-icon">♫</span><span><strong>{item.name}</strong>{showInformation && <small>{item.description}</small>}<em>{item.stems.join(" · ")}</em></span>
                  <span className={`status-dot ${capability?.available ? "is-ready" : ""}`} aria-label={capability?.available ? "Disponible" : "No disponible"} />
                </button>;
              })}</section>)}
            {visibleProfiles.length === 0 && <div className="model-empty"><strong>Sin resultados</strong><span>Prueba otra búsqueda o categoría.</span></div>}
          </div>
        </div>
      </dialog>
    </>
  );
}

function OptionsPanel({ profileId, setProfileId, outputFormat, setOutputFormat, publishToDemo, setPublishToDemo, capabilities }: {
  readonly profileId: ProfileId;
  readonly setProfileId: (value: ProfileId) => void;
  readonly outputFormat: OutputFormat;
  readonly setOutputFormat: (value: OutputFormat) => void;
  readonly publishToDemo: boolean;
  readonly setPublishToDemo: (value: boolean) => void;
  readonly capabilities: CapabilitiesResponse | null;
}) {
  return (
    <div className="options-panel">
      <label><span>Tipo de separación</span><ProfileButton value={profileId} onChange={setProfileId} capabilities={capabilities} /></label>
      <label><span>Codificación de salida</span><select value={outputFormat} onChange={(event) => setOutputFormat(event.target.value as OutputFormat)}>{outputFormats.map((format) => <option value={format} key={format}>{formatLabels[format]}</option>)}</select></label>
      <label className="switch-row"><span>Publicar en <Link to="/demo">demostración local</Link></span><input type="checkbox" checked={publishToDemo} onChange={(event) => setPublishToDemo(event.target.checked)} /><i /></label>
      <p className="panel-note">Sin cuentas, límites diarios, captchas ni formatos bloqueados.</p>
    </div>
  );
}

function HomePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data, loading, error, recheck } = useCapabilities();
  const requestedProfile = profileIdSchemaSafe(searchParams.get("profile"));
  const [profileId, setProfileId] = useState<ProfileId>(requestedProfile ?? "six-stems");
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("mp3-320");
  const [publishToDemo, setPublishToDemo] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (!file) return;
    setSubmitting(true); setSubmitError(null);
    try {
      const { job } = await api.createUpload({ file, profileId, outputFormat, publishToDemo });
      navigate(`/jobs/${job.id}`);
    } catch (reason) { setSubmitError(errorMessage(reason)); }
    finally { setSubmitting(false); }
  };
  const acceptDrop = (event: DragEvent) => {
    event.preventDefault(); setDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  };
  return (
    <div className="hero-surface">
      <div className="container page-section">
        <HeroHeading title="Separación de música y voz" subtitle="Divide cualquier audio en pistas con modelos abiertos ejecutados en tu equipo" />
        <CapabilityNotice capabilities={data} loading={loading} error={error} onRecheck={recheck} />
        <div className="separator-grid">
          <section className={`drop-zone ${dragging ? "is-dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={acceptDrop}>
            <input ref={input} type="file" accept="audio/*,video/*" hidden onChange={(event: ChangeEvent<HTMLInputElement>) => setFile(event.target.files?.[0] ?? null)} />
            <span className="upload-icon" aria-hidden="true">⇧</span>
            {file ? <><strong>{file.name}</strong><p>{(file.size / 1_048_576).toFixed(2)} MB · listo para separar</p></> : <><strong>Arrastra y suelta para cargar archivos</strong><div className="or-line"><span>o</span></div></>}
            <button className="button button--primary button--wide" onClick={() => input.current?.click()}>{file ? "Cambiar archivo" : "Seleccionar archivo"}</button>
            <div className="secondary-actions"><Link className="button button--outline" to="/remote">Carga remota</Link><Link className="button button--outline" to="/batch">Carga por lotes</Link></div>
          </section>
          <section className="submit-card">
            <OptionsPanel {...{ profileId, setProfileId, outputFormat, setOutputFormat, publishToDemo, setPublishToDemo, capabilities: data }} />
            {submitError && <p className="inline-error" role="alert">{submitError}</p>}
            <button className="button button--primary button--submit" disabled={!file || submitting || !data?.processor} onClick={() => void submit()}>
              {submitting ? <><span className="spinner" /> Cargando…</> : data?.processor ? "Separar" : "Procesador no disponible"}
            </button>
          </section>
        </div>
        <div className="open-summary"><strong>Sin créditos ni bloqueos.</strong><span>La cola usa la potencia de tu equipo y conserva los resultados durante 24 horas.</span></div>
      </div>
    </div>
  );
}

function profileIdSchemaSafe(value: string | null): ProfileId | null {
  return profiles.some((profile) => profile.id === value) ? value as ProfileId : null;
}

function RemotePage() {
  const navigate = useNavigate();
  const { data, loading, error, recheck } = useCapabilities();
  const [source, setSource] = useState<"direct" | "google-drive" | "dropbox" | "mega">("direct");
  const [url, setUrl] = useState("");
  const [profileId, setProfileId] = useState<ProfileId>("six-stems");
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("mp3-320");
  const [publishToDemo, setPublishToDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setFormError(null);
    try { const result = await api.createRemote({ url, source, profileId, outputFormat, publishToDemo }); navigate(`/jobs/${result.job.id}`); }
    catch (reason) { setFormError(errorMessage(reason)); }
    finally { setBusy(false); }
  };
  return (
    <div className="hero-surface"><div className="container narrow page-section">
      <HeroHeading title="Carga remota" subtitle="Descarga y separa audio usando únicamente una URL pública" />
      <CapabilityNotice capabilities={data} loading={loading} error={error} onRecheck={recheck} />
      <form className="form-card" onSubmit={submit}>
        <label><span>Tipo de carga</span><select value={source} onChange={(event) => setSource(event.target.value as typeof source)}><option value="direct">Enlace directo</option><option value="google-drive">Google Drive</option><option value="dropbox">Dropbox</option><option value="mega">MEGA (adaptador opcional)</option></select></label>
        <label><span>Enlace del archivo</span><input type="url" required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://ejemplo.com/cancion.mp3" /></label>
        <OptionsPanel {...{ profileId, setProfileId, outputFormat, setOutputFormat, publishToDemo, setPublishToDemo, capabilities: data }} />
        {formError && <p className="inline-error" role="alert">{formError}</p>}
        <button className="button button--primary button--submit" disabled={busy || !data?.processor}>{busy ? "Descargando…" : "Descargar y separar"}</button>
      </form>
    </div></div>
  );
}

function BatchPage() {
  const navigate = useNavigate();
  const { data, loading, error, recheck } = useCapabilities();
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState("");
  const [profileId, setProfileId] = useState<ProfileId>("four-stems");
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("mp3-320");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setFormError(null);
    try { const result = await api.createBatch({ files, name, profileId, outputFormat }); navigate(`/batches/${result.batch.id}`); }
    catch (reason) { setFormError(errorMessage(reason)); }
    finally { setBusy(false); }
  };
  return (
    <div className="hero-surface"><div className="container narrow page-section">
      <HeroHeading title="Procesamiento por lotes" subtitle="Añade varios archivos y procésalos en una cola persistente" />
      <CapabilityNotice capabilities={data} loading={loading} error={error} onRecheck={recheck} />
      <form className="form-card" onSubmit={submit}>
        <label><span>Nombre del lote <small>(opcional)</small></span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ensayos del viernes" /></label>
        <label><span>Archivos</span><input type="file" multiple required accept="audio/*,video/*" onChange={(event) => setFiles(Array.from(event.target.files ?? []))} /></label>
        {files.length > 0 && <ul className="file-list">{files.map((file) => <li key={`${file.name}-${file.size}`}><span>{file.name}</span><small>{(file.size / 1_048_576).toFixed(2)} MB</small></li>)}</ul>}
        <OptionsPanel {...{ profileId, setProfileId, outputFormat, setOutputFormat, publishToDemo: false, setPublishToDemo: () => undefined, capabilities: data }} />
        {formError && <p className="inline-error" role="alert">{formError}</p>}
        <button className="button button--primary button--submit" disabled={files.length === 0 || busy || !data?.processor}>{busy ? "Creando lote…" : `Separar ${files.length || ""} archivos`}</button>
      </form>
    </div></div>
  );
}

function BatchDetailsPage() {
  const { id = "" } = useParams();
  const [batch, setBatch] = useState<{ id: string; name: string; jobs: Job[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const result = await api.getBatch(id);
        if (active) { setBatch(result.batch); setError(null); }
      } catch (reason) {
        if (active) setError(errorMessage(reason));
      }
    };
    void load();
    const timer = setInterval(() => void load(), 2_000);
    return () => { active = false; clearInterval(timer); };
  }, [id]);
  if (error) return <CenteredError message={error} />;
  if (!batch) return <PageLoader />;
  const completed = batch.jobs.filter((job) => job.state === "completed").length;
  const terminal = batch.jobs.filter((job) => ["completed", "failed", "cancelled"].includes(job.state)).length;
  return <div className="container narrow page-section">
    <HeroHeading title={batch.name} subtitle={`${terminal} de ${batch.jobs.length} terminados · ${completed} completados`} />
    <div className="demo-list batch-results">{batch.jobs.map((job) => <article key={job.id}>
      <div><strong>{job.originalName}</strong><small>{Math.round(job.progress)}% · {job.state}</small></div>
      <Link className="button button--outline button--small" to={`/jobs/${job.id}`}>{job.state === "completed" ? "Descargar" : "Ver progreso"}</Link>
    </article>)}</div>
  </div>;
}

function JobPage() {
  const { id = "" } = useParams();
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  useEffect(() => {
    let active = true;
    let events: EventSource | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => { try { const result = await api.getJob(id); if (active) { setJob(result.job); if (["completed", "failed", "cancelled"].includes(result.job.state)) events?.close(); } } catch (reason) { if (active) setError(errorMessage(reason)); } };
    void load();
    events = new EventSource(`/api/jobs/${id}/events`);
    const refresh = () => { if (refreshTimer) clearTimeout(refreshTimer); refreshTimer = setTimeout(() => void load(), 75); };
    ["snapshot", "progress", "state", "artifact", "completed", "failed", "cancelled"].forEach((event) => events.addEventListener(event, refresh));
    events.onerror = () => { if (active) setTimeout(refresh, 1500); };
    return () => { active = false; events?.close(); if (refreshTimer) clearTimeout(refreshTimer); };
  }, [id]);
  if (error) return <CenteredError message={error} />;
  if (!job) return <PageLoader />;
  const terminal = ["completed", "failed", "cancelled"].includes(job.state);
  const stateLabel: Record<string, string> = { queued: "En cola", preparing: "Preparando", processing: "Separando", encoding: "Codificando", cancelling: "Cancelando", completed: "Completado", failed: "Falló", cancelled: "Cancelado" };
  return (
    <div className="hero-surface"><div className="container narrow page-section">
      <HeroHeading title={job.originalName} subtitle={`${profiles.find((profile) => profile.id === job.profileId)?.name} · ${formatLabels[job.outputFormat]}`} />
      <section className="result-card">
        <div className="job-state"><span className={`state-badge state-${job.state}`}>{stateLabel[job.state]}</span><strong>{Math.round(job.progress)}%</strong></div>
        <div className="progress-track"><span style={{ width: `${job.progress}%` }} /></div>
        {!terminal && <p>El trabajo puede continuar aunque cierres esta página.</p>}
        {job.errorMessage && <p className="inline-error" role="alert">{job.errorMessage}</p>}
        {!terminal && <button className="button button--outline" disabled={cancelling} onClick={() => { setCancelling(true); void api.cancelJob(job.id).then(({ job: updated }) => setJob(updated)).catch((reason) => setError(errorMessage(reason))).finally(() => setCancelling(false)); }}>{cancelling ? "Cancelando…" : "Cancelar"}</button>}
        {job.artifacts.length > 0 && <div className="artifact-list"><div className="artifact-heading"><h2>Pistas separadas</h2><a className="button button--primary button--small" href={`/api/jobs/${job.id}/download.zip`}>Descargar ZIP</a></div>{job.artifacts.map((artifact) => <article key={artifact.id}><div><span className="audio-mark">♫</span><span><strong>{artifact.stem}</strong><small>{(artifact.bytes / 1_048_576).toFixed(2)} MB</small></span></div><audio controls preload="none" src={artifact.downloadUrl} /><a className="button button--outline button--small" href={artifact.downloadUrl}>Descargar</a></article>)}</div>}
      </section>
    </div></div>
  );
}

const toolCards = [
  ["Vocal Remover", "Elimina voces o extrae el instrumental.", "vocals"], ["Karaoke Maker", "Crea una pista de karaoke limpia.", "vocals-ft"], ["Stem Splitter", "Voz, batería, bajo, guitarra, piano y otros.", "six-stems"], ["Drum Extractor", "Aísla la batería para práctica o sampling.", "drums"], ["Bass Extractor", "Extrae la línea de bajo.", "bass"], ["Piano Extractor", "Aísla el piano del arreglo completo.", "piano"], ["Guitar Extractor", "Extrae guitarras del arreglo completo.", "guitar"],
  ["Acoustic Guitar", "Aísla guitarra acústica con AudioSep.", "acoustic-guitar"], ["Percussion Extractor", "Aísla instrumentos de percusión.", "percussion"], ["Trumpet Extractor", "Aísla trompeta del resto de la mezcla.", "trumpet"], ["Keyboard Extractor", "Aísla teclados musicales.", "keyboards"], ["Synth Extractor", "Aísla sintetizadores.", "synthesizer"], ["Violin Extractor", "Aísla violín del resto de la mezcla.", "violin"],
  ["Remove Background Music", "Aísla voz y acompañamiento.", "vocals"], ["Noise Removal", "Requiere DeepFilterNet opcional.", "optional"], ["Reverb Removal", "Requiere un modelo de dereverberación.", "optional"], ["Audio Upscaler", "Requiere un modelo de superresolución.", "optional"], ["Audio to Text", "Requiere Whisper opcional.", "optional"], ["Online Mastering", "Requiere Matchering opcional.", "optional"], ["Audio to MIDI", "Requiere Basic Pitch opcional.", "optional"],
] as const;

function ToolsPage() {
  const navigate = useNavigate();
  return <div className="container page-section"><HeroHeading title="Herramientas" subtitle="Perfiles gratuitos y adaptadores locales para cada flujo de audio" /><div className="tools-grid">{toolCards.map(([title, description, profile]) => <article className="tool-card" key={title}><span className="tool-icon">♫</span><h2>{title}</h2><p>{description}</p>{profile === "optional" ? <span className="capability-pill">Modelo opcional</span> : <button className="text-link" onClick={() => navigate(`/?profile=${profile}`)}>Usar herramienta →</button>}</article>)}</div></div>;
}

function AlgorithmsPage() {
  return <div className="container page-section"><HeroHeading title="Algoritmos abiertos" subtitle="Perfiles instalables sin pagar por créditos ni enviar audio a terceros" /><div className="algorithm-list">{profiles.map((profile, index) => <article key={profile.id}><div className="algorithm-number">0{index + 1}</div><div><h2>{profile.name}</h2><p>{profile.description}</p><div className="stem-chips">{profile.stems.map((stem) => <span key={stem}>{stem}</span>)}</div></div><Link className="button button--outline" to={`/?profile=${profile.id}`}>Usar algoritmo</Link></article>)}</div></div>;
}

function PlansPage() {
  const rows = [["Longitud máxima", "Configurable"], ["Tamaño máximo", "1 GB por defecto"], ["Separaciones diarias", "Ilimitadas"], ["Trabajos concurrentes", "Configurable"], ["Formatos", "MP3, WAV, FLAC, M4A"], ["Procesamiento por lotes", "Incluido"], ["API", "Completa y local"], ["Captcha", "Nunca"]];
  return <div className="container page-section"><HeroHeading title="Todo incluido" subtitle="OpenSep no tiene planes de pago: el límite es el hardware de tu instalación" /><section className="free-plan"><div className="plan-heading"><span>OPEN SOURCE</span><h2>Gratis para siempre</h2><p>Sin tarjeta, cuentas, suscripciones ni créditos.</p><Link className="button button--primary" to="/">Empezar a separar</Link></div><div className="feature-table">{rows.map(([label, value]) => <div key={label}><span>{label}</span><strong>✓ {value}</strong></div>)}</div></section><p className="hosting-note">El uso es gratuito para quien procesa, pero quien hospeda la aplicación aporta CPU/GPU, almacenamiento y ancho de banda.</p></div>;
}

function DemoPage() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void api.listJobs(true).then(({ jobs: values }) => setJobs(values)).catch((reason) => setError(errorMessage(reason))); }, []);
  return <div className="container page-section"><HeroHeading title="Demostración" subtitle="Resultados que decidiste publicar dentro de esta instalación" />{error ? <CenteredError message={error} /> : !jobs ? <PageLoader /> : jobs.length === 0 ? <div className="empty-state"><span>♫</span><h2>Todavía no hay demostraciones</h2><p>Activa “Publicar en demostración local” al crear un trabajo.</p><Link className="button button--primary" to="/">Crear la primera</Link></div> : <div className="demo-list">{jobs.map((job) => <article key={job.id}><div><strong>{job.originalName}</strong><small>{new Date(job.finishedAt ?? job.createdAt).toLocaleString()} · {profiles.find((profile) => profile.id === job.profileId)?.name}</small></div><Link className="button button--outline button--small" to={`/jobs/${job.id}`}>Resultado</Link></article>)}</div>}</div>;
}

function PageLoader() { return <div className="page-loader"><span className="spinner" /><p>Cargando…</p></div>; }
function CenteredError({ message }: { readonly message: string }) { return <div className="empty-state error-state"><span>!</span><h2>No se pudo cargar</h2><p>{message}</p><Link className="button button--outline" to="/">Volver al inicio</Link></div>; }
function NotFoundPage() { return <div className="container page-section"><div className="empty-state"><span>404</span><h1>Página no encontrada</h1><p>La dirección solicitada no existe.</p><Link className="button button--primary" to="/">Volver al inicio</Link></div></div>; }

export function App() { return <Shell />; }
