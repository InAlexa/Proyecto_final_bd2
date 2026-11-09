import { useEffect, useMemo, useState, type FormEvent, type CSSProperties } from 'react'
import type { AuthSession, InstitutionId, Patient } from './domain'
import { institutionById, institutions } from './data/institutions'
import { workspaceSections, postgresTableGroups } from './data/workspaces'
import { RelationalDataEntry } from './components/RelationalDataEntry'
import { LabExamEntry } from './components/LabExamEntry'
import { InstitutionWorkflow } from './components/InstitutionWorkflow'

type ModalState = 'new' | 'patient' | null

function App() {
  const [activeId, setActiveId] = useState<InstitutionId>('hospital')
  const [user, setUser] = useState<AuthSession | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [activeSection, setActiveSection] = useState('overview')
  const [patients, setPatients] = useState<Record<InstitutionId, Patient[]>>({ hospital: [], pediatria: [], odontologia: [], laboratorio: [] })
  const [patientLoading, setPatientLoading] = useState(false)
  const [patientLoadError, setPatientLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<ModalState>(null)
  const [archiveNewPatient, setArchiveNewPatient] = useState(false)
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [toast, setToast] = useState('')
  const active = institutionById(activeId)
  const sections = workspaceSections[activeId]
  const list = patients[activeId]
  const visiblePatients = useMemo(() => list.filter((patient) =>
    `${patient.name} ${patient.record} ${patient.detail}`.toLowerCase().includes(search.toLowerCase())), [list, search])

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me', { credentials: 'include' })
      .then(async (response) => response.ok ? response.json() as Promise<AuthSession> : null)
      .then((session) => {
        if (cancelled) return
        if (session) {
          setUser(session)
          if (session.institutionId) setActiveId(session.institutionId)
        }
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setAuthReady(true) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    setPatientLoading(true)
    setPatientLoadError('')
    fetch(`/api/patients?institution=${encodeURIComponent(activeId)}&search=${encodeURIComponent(search)}`, { credentials: 'include' })
      .then(async (response) => {
        const payload = await response.json() as { patients?: Patient[]; error?: string }
        if (!response.ok) throw new Error(payload.error ?? 'No se pudo cargar la información.')
        if (!cancelled && payload.patients) setPatients((current) => ({ ...current, [activeId]: payload.patients! }))
      })
      .catch(() => { if (!cancelled) setPatientLoadError('No se pudo actualizar la información. Intenta de nuevo.') })
      .finally(() => { if (!cancelled) setPatientLoading(false) })
    return () => { cancelled = true }
  }, [user, activeId, search])

  function flash(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(''), 3400)
  }

  function chooseInstitution(id: InstitutionId) {
    if (user?.role !== 'admin' && user?.institutionId !== id) return
    setActiveId(id)
    setActiveSection('overview')
    setSearch('')
  }

  function signIn(session: AuthSession) {
    setUser(session)
    if (session.institutionId) {
      setActiveId(session.institutionId)
      setActiveSection('overview')
    }
    setSearch('')
  }

  function signOut() {
    void fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => undefined)
    setUser(null)
    setModal(null)
    setSelectedPatient(null)
    setToast('')
  }

  async function addPatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const fullName = String(formData.get('fullName') || '').trim()
    const names = String(formData.get('names') || '').trim()
    const surnames = String(formData.get('surnames') || '').trim()
    const dpi = String(formData.get('dpi')).trim()
    const birthDate = String(formData.get('birthDate'))
    const sex = String(formData.get('sex') || 'no_informado')
    const phone = String(formData.get('phone')).trim()
    const email = String(formData.get('email') || '').trim()
    const address = String(formData.get('address') || '').trim()
    const requestedStatus = String(formData.get('status') || (activeId === 'laboratorio' ? 'ACTIVO' : 'activo'))
    const status = activeId === 'laboratorio' ? (requestedStatus === 'ACTIVO' ? 'activo' : 'archivado') : requestedStatus
    const archiveDate = String(formData.get('archiveDate') || '')
    const archiveReason = String(formData.get('archiveReason') || '').trim()
    try {
      const response = await fetch('/api/patients', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ institutionId: activeId, patient: { name: fullName || undefined, names, surnames, dpi: dpi || null, birthDate, sex, phone: phone || null, email: email || null, address: address || null, status: activeId === 'laboratorio' ? requestedStatus : status, archiveDate: archiveDate || null, archiveReason: archiveReason || null } }),
      })
      const payload = await response.json() as { patient?: Patient; error?: string }
      if (!response.ok || !payload.patient) throw new Error(payload.error ?? 'No se pudo guardar el expediente.')
      setPatients((current) => ({ ...current, [activeId]: [payload.patient!, ...current[activeId]] }))
      setModal(null)
      setArchiveNewPatient(false)
      flash('Paciente registrado.')
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : ''
      flash(message.includes('Failed to fetch')
        ? 'No se pudo contactar al servidor. Intenta de nuevo en un momento.'
        : message || 'No se pudo guardar el expediente. Revisa los datos e intenta de nuevo.')
    }
  }

  if (!authReady) return <main className="app-loading"><span className="brand-mark">+</span><strong>Clínica OS</strong></main>
  if (!user) return <Login onLogin={signIn} />

  return (
    <main className="app-shell" style={{ '--accent': active.accent, '--accent-soft': active.accentSoft } as CSSProperties}>
      <header className="topbar">
        <a className="brand" href="#inicio" aria-label="Clínica OS inicio">
          <span className="brand-mark">+</span>
          <span className="brand-copy"><strong>Clínica OS</strong><small>SISTEMA CLÍNICO</small></span>
        </a>
        {user.role === 'admin' ? <nav className="top-nav" aria-label="Seleccionar institución">
          {institutions.map((institution) => (
            <button key={institution.id} className={`nav-link ${institution.id === activeId ? 'active' : ''}`} onClick={() => chooseInstitution(institution.id)}>
              {institution.shortName}
            </button>
          ))}
        </nav> : <div className="locked-institution"><span style={{ background: active.accent }}>{active.icon}</span>{active.name}</div>}
        <div className="user-controls"><div className="top-status"><span className="status-dot" /> {user.role === 'admin' ? 'Administrador' : 'Acceso institucional'}</div><button className="user-chip" onClick={signOut}><span className="user-initial">{user.displayName[0]}</span>{user.displayName}<b>Salir</b></button></div>
      </header>

      <section id="inicio" className="hero panel">
        <div className="hero-copy">
          <h1>{user.role === 'admin' ? <>Un sistema clínico.<br /><span>Cuatro instituciones.</span></> : <>{active.name}.<br /><span>Espacio clínico.</span></>}</h1>
          <p>{user.role === 'admin' ? 'Vista administrativa para revisar la actividad de las instituciones.' : `Consulta y administra los expedientes de ${active.name}.`}</p>
        </div>
        <div className="hero-side">
          <div className="hero-side-icon"><span>✳</span></div>
          <strong>{user.role === 'admin' ? user.displayName : active.name}</strong>
        </div>
        <div className="hero-orb orb-one" /><div className="hero-orb orb-two" />
      </section>

      {user.role === 'admin' && <section className="institution-section panel">
        <div className="section-heading">
          <div><span className="eyebrow">ESPACIOS DE TRABAJO</span><h2>Instituciones</h2><p>Selecciona el espacio que quieres revisar.</p></div>
          <div className="section-count"><strong>04</strong><span>instituciones</span></div>
        </div>
        <div className="institution-grid">
          {institutions.map((institution) => <button key={institution.id} className={`institution-card ${activeId === institution.id ? 'selected' : ''}`} onClick={() => chooseInstitution(institution.id)} style={{ '--card-accent': institution.accent, '--card-soft': institution.accentSoft } as CSSProperties}>
            <div className="institution-card-top"><span>{institution.icon}</span><span className="card-arrow">↗</span></div>
            <div className="institution-card-body"><strong>{institution.name}</strong><small>{institution.specialty}</small><span className="card-open">{activeId === institution.id ? 'Espacio abierto' : 'Abrir espacio'} <b>→</b></span></div>
          </button>)}
        </div>
      </section>}

      <section id="workspace" className="workspace panel">
        <div className="workspace-heading">
          <div className="workspace-title-wrap">
            <div className="institution-avatar" style={{ background: active.accent }}>{active.icon}</div>
            <div><span className="eyebrow">ESPACIO INSTITUCIONAL</span><h2>{active.name}</h2><p>{active.specialty}</p></div>
          </div>
        </div>

        <nav className="workspace-tabs" aria-label={`Apartados de ${active.name}`}>
          {sections.map((section) => <button key={section.id} className={activeSection === section.id ? 'active' : ''} onClick={() => setActiveSection(section.id)}>{section.label}</button>)}
        </nav>

        {activeSection === 'overview' && <div className="workspace-content">
          <Metrics institution={activeId} />
          <div className="module-heading"><div><span className="eyebrow">RESUMEN</span><h3>{moduleTitle(activeId)}</h3></div></div>
          <ClinicalModule institution={activeId} />
        </div>}

        {activeSection === 'patients' && (activeId === 'pediatria' || activeId === 'odontologia') && <div className="workspace-content"><p className="section-description">{sections.find((section) => section.id === activeSection)?.description}</p><InstitutionWorkflow institution={activeId} section={activeSection} onSaved={flash} /></div>}

        {activeSection === 'patients' && activeId !== 'pediatria' && activeId !== 'odontologia' && <div className="workspace-content">
          <div className="module-heading"><div><span className="eyebrow">EXPEDIENTES</span><h3>Directorio de pacientes</h3><p>Identificación, contacto y datos personales en un solo formulario.</p></div><button className="button button-primary" onClick={() => { setArchiveNewPatient(false); setModal('new') }}><span>＋</span> Nuevo ingreso</button></div>
          <div className="patients-heading"><div><span className="eyebrow">REGISTROS</span><h3>Pacientes</h3><p>Los identificadores pertenecen únicamente a {active.name}.</p></div>
            <label className="search-box"><span aria-hidden="true">⌕</span><input aria-label="Buscar pacientes" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre o expediente" /><kbd>⌘ K</kbd></label>
          </div>
          <div className="table-wrap">
            <table><thead><tr><th>PACIENTE</th><th>EXPEDIENTE</th><th>DETALLE</th><th>ESTADO</th><th>ACTUALIZACIÓN</th><th /></tr></thead>
              <tbody>{patientLoading && <tr><td colSpan={6} className="empty-state">Cargando expedientes…</td></tr>}
                {!patientLoading && patientLoadError && <tr><td colSpan={6} className="empty-state">{patientLoadError}</td></tr>}
                {!patientLoading && !patientLoadError && visiblePatients.map((patient) => <tr key={patient.id}>
                  <td><span className="patient-cell"><span className="patient-avatar">{patient.initials}</span><strong>{patient.name}</strong></span></td>
                  <td><span className="record-code">{patient.record}</span></td><td className="detail-cell">{patient.detail}</td>
                  <td><StatusBadge status={patient.status} /></td><td className="updated-cell">{patient.updated}</td>
                  <td><button className="table-action" onClick={() => { setSelectedPatient(patient); setModal('patient') }}>Abrir ficha <span>↗</span></button></td>
                </tr>)}
                {!patientLoading && !patientLoadError && visiblePatients.length === 0 && <tr><td colSpan={6} className="empty-state">No hay coincidencias. Prueba otro nombre o número de expediente.</td></tr>}</tbody>
            </table>
          </div>
          <div className="table-footer"><span>Mostrando <strong>{visiblePatients.length}</strong> pacientes</span><button onClick={() => setSearch('')}>Limpiar búsqueda <b>→</b></button></div>
          {activeId === 'hospital' && <div className="related-entry-block"><div className="module-heading"><div><span className="eyebrow">CONTACTOS RELACIONADOS</span><h3>Contactos de emergencia</h3></div></div><RelationalDataEntry groupId="patients" onSaved={flash} /></div>}
        </div>}

        {activeId === 'hospital' && activeSection !== 'overview' && activeSection !== 'patients' && postgresTableGroups[activeSection] && <div className="workspace-content"><p className="section-description">{sections.find((section) => section.id === activeSection)?.description}</p><RelationalDataEntry groupId={activeSection} onSaved={flash} /></div>}
        {activeId === 'laboratorio' && activeSection === 'exams' && <div className="workspace-content"><p className="section-description">{sections.find((section) => section.id === activeSection)?.description}</p><LabExamEntry patients={list} onSaved={flash} /></div>}
        {(activeId === 'pediatria' || activeId === 'odontologia') && activeSection !== 'overview' && activeSection !== 'patients' && <div className="workspace-content"><p className="section-description">{sections.find((section) => section.id === activeSection)?.description}</p><InstitutionWorkflow institution={activeId} section={activeSection} onSaved={flash} /></div>}
      </section>

      <footer className="footer"><span><b>Clínica OS</b> · {user.role === 'admin' ? 'Administración multiinstitución' : active.name}</span><span>{user.role === 'admin' ? '4 espacios' : 'Espacio institucional'}</span></footer>

      {modal === 'new' && <Modal title="Nuevo ingreso" subtitle={`Crear expediente en ${active.name}`} onClose={() => setModal(null)}>
        <form className="patient-form" onSubmit={addPatient}>
          {activeId === 'laboratorio' ? <label className="form-wide">Nombre completo<input name="fullName" maxLength={200} required autoFocus placeholder="Ej. Ana María López García" /></label> : <>
            <label>Nombres<input name="names" maxLength={100} required autoFocus placeholder="Ej. Ana María" /></label>
            <label>Apellidos<input name="surnames" maxLength={100} required placeholder="Ej. López García" /></label>
          </>}
          <label>DPI<input name="dpi" inputMode="numeric" maxLength={13} pattern="[0-9]{13}" placeholder="13 dígitos" required={activeId === 'laboratorio'} /></label>
          <label>Fecha de nacimiento<input name="birthDate" type="date" required /></label>
          <label>Sexo registrado<select name="sex" defaultValue="no_informado"><option value="no_informado">No informado</option><option value="femenino">Femenino</option><option value="masculino">Masculino</option><option value="otro">Otro</option></select></label>
          <label>Estado del expediente<select name="status" defaultValue={activeId === 'laboratorio' ? 'ACTIVO' : 'activo'} onChange={(event) => setArchiveNewPatient(activeId === 'laboratorio' ? event.target.value !== 'ACTIVO' : event.target.value === 'archivado')}>
            {activeId === 'laboratorio' ? <><option value="ACTIVO">Activo</option><option value="INACTIVO">Inactivo</option><option value="FALLECIDO">Fallecido</option><option value="TRASLADADO">Trasladado</option></> : <><option value="activo">Activo</option><option value="archivado">Archivado</option></>}
          </select></label>
          <label className="form-wide">Dirección<textarea name="address" rows={2} placeholder="Dirección de residencia" /></label>
          {activeId === 'laboratorio' && <>
            <label className="form-wide">Teléfono de contacto<input name="phone" type="tel" maxLength={25} placeholder="+502 …" /></label>
            <label className="form-wide">Correo electrónico<input name="email" type="email" maxLength={150} placeholder="paciente@correo.com" /></label>
          </>}
          {archiveNewPatient && <>
            <label>{activeId === 'laboratorio' ? 'Fecha de baja' : 'Fecha de archivo'}<input name="archiveDate" type="date" required /></label>
            <label>{activeId === 'laboratorio' ? 'Motivo de baja' : 'Motivo de archivo'}<input name="archiveReason" maxLength={500} required placeholder="Ej. Traslado a otra institución" /></label>
          </>}
          <div className="form-actions"><button type="button" className="button button-quiet" onClick={() => setModal(null)}>Cancelar</button><button type="submit" className="button button-primary">Agregar paciente</button></div>
        </form>
      </Modal>}
      {modal === 'patient' && selectedPatient && <Modal title={selectedPatient.name} subtitle={`Expediente ${selectedPatient.record}`} onClose={() => setModal(null)}>
        <PatientHistory institution={activeId} patient={selectedPatient} />
        <div className="record-preview"><div className="record-preview-icon">{selectedPatient.initials}</div><StatusBadge status={selectedPatient.status} /><RecordLine label="Estado registrado" value={selectedPatient.statusValue} /><RecordLine label="DPI" value={selectedPatient.dpi} /><RecordLine label="Fecha de nacimiento" value={displayDate(selectedPatient.birthDate)} /><RecordLine label="Sexo registrado" value={selectedPatient.sex ? sexLabel(selectedPatient.sex) : undefined} /><RecordLine label="Dirección" value={selectedPatient.address} /><RecordLine label="Teléfono" value={selectedPatient.phone} /><RecordLine label="Correo electrónico" value={selectedPatient.email} /><RecordLine label="Fecha de registro" value={selectedPatient.createdAt || selectedPatient.updated} /><RecordLine label="Fecha de archivo" value={displayDate(selectedPatient.archiveDate)} /><RecordLine label="Motivo de archivo" value={selectedPatient.archiveReason} />{selectedPatient.status!=='Archivado'&&<button className="button button-quiet" onClick={async()=>{const reason=window.prompt('Motivo de archivo o baja del expediente');if(!reason?.trim())return;try{const response=await fetch(`/api/patients/${encodeURIComponent(selectedPatient.id)}/archive`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({institutionId:activeId,reason})});const payload=await response.json();if(!response.ok)throw new Error(payload.error);const archived={...selectedPatient,status:'Archivado' as const,archiveDate:new Date().toISOString().slice(0,10),archiveReason:reason};setSelectedPatient(archived);setPatients(current=>({...current,[activeId]:current[activeId].map(p=>p.id===archived.id?archived:p)}));flash('Expediente archivado.')}catch(e){flash(e instanceof Error?e.message:'No se pudo archivar')}}}>Archivar expediente</button>}</div>
      </Modal>}
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  )
}

function moduleTitle(id: InstitutionId) {
  return ({ hospital: 'Hospitalización y seguimiento', pediatria: 'Turnos, crecimiento y vacunas', odontologia: 'Agenda y odontograma', laboratorio: 'Órdenes y resultados de laboratorio' })[id]
}

function Login({ onLogin }: { onLogin: (session: AuthSession) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const payload = await response.json() as AuthSession & { error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'No se pudo iniciar sesión.')
      setError('')
      onLogin(payload)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : ''
      setError(message.includes('Failed to fetch') ? 'No se pudo contactar al servidor. Intenta de nuevo en un momento.' : message || 'Usuario o contraseña incorrectos.')
    }
  }

  return <main className="login-shell">
    <header className="login-header"><a className="brand" href="#login" aria-label="Clínica OS"><span className="brand-mark">+</span><span className="brand-copy"><strong>Clínica OS</strong><small>SISTEMA CLÍNICO</small></span></a></header>
    <div className="login-layout">
      <section className="login-story">
        <span className="eyebrow hero-eyebrow">ACCESO INSTITUCIONAL</span>
        <h1>La información clínica,<br /><span>en su espacio correcto.</span></h1>
        <p>Inicia sesión para acceder a las funciones habilitadas para tu cuenta.</p>
        <div className="login-institution-list">{institutions.map((institution) => <div className="login-institution" key={institution.id}><span className="login-inst-icon" style={{ background: institution.accent }}>{institution.icon}</span><span><strong>{institution.name}</strong><small>{institution.specialty}</small></span><i /></div>)}</div>
        <div className="login-story-footer"><span className="login-shield">✓</span><span><strong>Acceso por institución</strong><small>Los usuarios ven las funciones asignadas a su cuenta.</small></span></div>
      </section>
      <section className="login-card" aria-labelledby="login-title">
        <span className="eyebrow">CLÍNICA OS · SISTEMA CLÍNICO</span>
        <h2 id="login-title">Iniciar sesión</h2>
        <p className="login-subtitle">Ingresa con tus credenciales institucionales.</p>
        <form className="login-form" onSubmit={submit}>
          <label>Usuario<input name="username" autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Escribe tu usuario" /></label>
          <label>Contraseña<input name="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Escribe tu contraseña" /></label>
          {error && <div className="login-error" role="alert">{error}</div>}
          <button className="button button-primary login-submit" type="submit">Entrar al sistema <span>→</span></button>
        </form>
        <p className="login-help">Si no puedes entrar, solicita ayuda al administrador del sistema.</p>
      </section>
    </div>
    <footer className="login-footer"><span>Clínica OS · Sistema clínico multiinstitución</span><span>Atención médica <i /> Historiales clínicos <i /> Acceso institucional</span></footer>
  </main>
}

type OverviewData = { metrics: Array<{ label: string; value: string; caption: string }>; activity: Array<{ kind: string; date: string; summary: string; detail?: string }> }

function useOverview(institution: InstitutionId) {
  const [data,setData]=useState<OverviewData>({metrics:[],activity:[]});const [error,setError]=useState('');const [loading,setLoading]=useState(true)
  useEffect(()=>{let cancelled=false;setLoading(true);setError('');fetch(`/api/overview?institution=${encodeURIComponent(institution)}`,{credentials:'include'}).then(async response=>{const payload=await response.json() as OverviewData & {error?:string};if(!response.ok)throw new Error(payload.error||'No se pudo cargar el resumen.');if(!cancelled)setData(payload)}).catch(reason=>{if(!cancelled)setError(reason instanceof Error?reason.message:'No se pudo cargar el resumen.')}).finally(()=>{if(!cancelled)setLoading(false)});return()=>{cancelled=true}},[institution])
  return {data,error,loading}
}

function Metrics({ institution }: { institution: InstitutionId }) {
  const {data,error,loading}=useOverview(institution)
  if(error)return <div className="module-card entry-error" role="alert">{error}</div>
  return <div className="metrics-grid">{loading&&!data.metrics.length?<div className="module-card">Cargando indicadores…</div>:data.metrics.map(({label,value,caption},index)=><article className="metric-card" key={label}><span>{label}</span><div><strong>{value}</strong><small>{caption}</small></div><div className={`metric-spark spark-${index}`}><i/><i/><i/><i/><i/><i/><i/></div></article>)}</div>
}

function ClinicalModule({ institution }: { institution: InstitutionId }) {
  const {data,error,loading}=useOverview(institution)
  return <section className="module-card"><div className="module-card-top"><div><span className="eyebrow">ACTIVIDAD PERSISTIDA</span><strong>Actividad reciente</strong><small>Datos consultados desde la base de {institutionById(institution).name}.</small></div></div>{error?<p className="entry-error" role="alert">{error}</p>:loading?<p className="empty-state">Cargando actividad…</p>:data.activity.length===0?<p className="empty-state">Todavía no hay actividad clínica registrada.</p>:<div className="recent-record-list">{data.activity.map((item,index)=><article key={`${item.kind}-${item.date}-${index}`}><span><small>{item.kind}</small><strong>{item.summary}</strong></span><span><small>{new Date(item.date).toLocaleString('es-GT')}</small><strong>{item.detail||'—'}</strong></span></article>)}</div>}</section>
}

function StatusBadge({ status }: { status: string }) {
  const cls = status.toLowerCase().replaceAll(' ', '-')
  return <span className={`status-badge status-${cls}`}><i />{status}</span>
}

function RecordLine({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return <div className="record-preview-line"><span>{label}</span><strong>{value}</strong></div>
}

function PatientHistory({ institution, patient }: { institution: InstitutionId; patient: Patient }) {
  const [records,setRecords]=useState<Array<{kind:string;date:string;summary:string;detail?:string}>>([])
  const [error,setError]=useState('')
  useEffect(()=>{let cancelled=false;fetch(`/api/clinical/history?institution=${encodeURIComponent(institution)}&patientId=${encodeURIComponent(patient.id)}`,{credentials:'include'}).then(async r=>{const p=await r.json() as {records?:typeof records;error?:string};if(!r.ok)throw new Error(p.error||'No se pudo cargar el historial.');if(!cancelled)setRecords(p.records||[])}).catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:'No se pudo cargar el historial.')});return()=>{cancelled=true}},[institution,patient.id])
  return <section className="record-history"><h3>Historial clínico</h3>{error?<p role="alert">{error}</p>:records.length===0?<p>Sin consultas, citas o eventos clínicos registrados.</p>:records.map((r,i)=><article key={`${r.kind}-${r.date}-${i}`}><small>{r.kind} · {new Date(r.date).toLocaleString('es-GT')}</small><strong>{r.summary}</strong>{r.detail&&<p>{r.detail}</p>}</article>)}</section>
}

function displayDate(value?: string | null) {
  if (!value) return undefined
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('es-GT', { dateStyle: 'long', timeZone: 'UTC' }).format(date)
}

function sexLabel(value: string) {
  return ({ femenino: 'Femenino', masculino: 'Masculino', otro: 'Otro', no_informado: 'No informado' })[value] ?? value
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="modal-close" aria-label="Cerrar" onClick={onClose}>×</button><span className="eyebrow">CLÍNICA OS</span><h2 id="modal-title">{title}</h2><p>{subtitle}</p>{children}</section></div>
}

export default App
