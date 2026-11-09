import { useEffect, useMemo, useState, type FormEvent } from 'react'

type ReferenceOption = { value: string; label: string }
type ColumnDefinition = {
  name: string
  label: string
  dataType: string
  required: boolean
  nullable: boolean
  defaulted: boolean
  identity: boolean
  generated: boolean
  isForeignKey: boolean
  choices: string[]
  referenceOptions: ReferenceOption[]
}
type TableDefinition = { name: string; label: string; columns: ColumnDefinition[] }
type TableGroup = { id: string; label: string; tables: TableDefinition[] }
type RecentData = { columns: string[]; records: Record<string, unknown>[] }

function ClinicalEncounter({onSaved}:{onSaved:(message:string)=>void}) {
  const [options,setOptions]=useState<{patients:{id:number;label:string}[];doctors:{id:number;label:string}[];medicines:{id:number;label:string}[]}>({patients:[],doctors:[],medicines:[]});const [error,setError]=useState('');const [saving,setSaving]=useState(false)
  useEffect(()=>{let cancelled=false;fetch('/api/hospital/options',{credentials:'include'}).then(async r=>{const p=await r.json();if(!r.ok)throw new Error(p.error);if(!cancelled)setOptions(p)}).catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:'No se cargaron los catálogos')});return()=>{cancelled=true}},[])
  async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();setSaving(true);setError('');const f=event.currentTarget;const d=new FormData(f);try{const r=await fetch('/api/clinical/encounter',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({institutionId:'hospital',patientId:d.get('patientId'),doctorId:d.get('doctorId'),motivo:d.get('motivo'),enfermedadActual:d.get('enfermedadActual'),examenFisico:d.get('examenFisico'),diagnostico:d.get('diagnostico'),clasificacion:d.get('clasificacion'),tratamiento:d.get('tratamiento'),medicamentoId:d.get('medicamentoId'),dosis:d.get('dosis'),via:d.get('via'),frecuencia:d.get('frecuencia'),duracion:d.get('duracion')})});const p=await r.json();if(!r.ok)throw new Error(p.error);f.reset();onSaved('Consulta, diagnóstico y plan clínico guardados.')}catch(e){setError(e instanceof Error?e.message:'No se pudo guardar')}finally{setSaving(false)}}
  return <section className="module-card entity-form-card"><div className="module-card-top"><div><span className="eyebrow">ATENCIÓN CLÍNICA</span><strong>Registrar consulta completa</strong><small>La consulta, diagnóstico, tratamiento y receta se guardan en una transacción.</small></div></div><form className="record-entry-form" onSubmit={save}><label><span>Paciente</span><select name="patientId" required><option value="">Selecciona</option>{options.patients.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select></label><label><span>Médico</span><select name="doctorId" required><option value="">Selecciona</option>{options.doctors.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select></label><label><span>Motivo de consulta</span><input name="motivo" required /></label><label><span>Enfermedad actual</span><input name="enfermedadActual" required /></label><label className="entry-wide"><span>Examen físico</span><textarea name="examenFisico" required /></label><label className="entry-wide"><span>Diagnóstico</span><textarea name="diagnostico" required /></label><label><span>Clasificación</span><select name="clasificacion"><option value="definitivo">Definitivo</option><option value="presuntivo">Presuntivo</option></select></label><label><span>Tratamiento</span><input name="tratamiento" /></label><label><span>Medicamento</span><select name="medicamentoId"><option value="">Sin receta</option>{options.medicines.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select></label><label><span>Dosis</span><input name="dosis" /></label><label><span>Vía</span><input name="via" /></label><label><span>Frecuencia</span><input name="frecuencia" /></label><label><span>Duración (días)</span><input name="duracion" type="number" min="1" /></label>{error&&<div className="entry-error entry-wide" role="alert">{error}</div>}<div className="entry-actions entry-wide"><button className="button button-primary" disabled={saving}>{saving?'Guardando…':'Guardar consulta'}</button></div></form></section>
}

function labelFor(name: string) {
  const humanized = name.replaceAll('_', ' ')
  return humanized.replace(/\b(id)\b/gi, 'ID').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function inputType(dataType: string) {
  if (dataType.includes('date') && !dataType.includes('time')) return 'date'
  if (dataType.includes('time')) return dataType.includes('zone') || dataType.includes('timestamp') ? 'datetime-local' : 'time'
  if (['smallint', 'integer', 'bigint', 'numeric', 'decimal', 'real', 'double precision'].includes(dataType)) return 'number'
  return 'text'
}

function displayValue(value: unknown) {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function RelationalDataEntry({ groupId, onSaved }: { groupId: string; onSaved: (message: string) => void }) {
  if(groupId==='care') return <ClinicalEncounter onSaved={onSaved}/>
  const [group, setGroup] = useState<TableGroup | null>(null)
  const [selectedName, setSelectedName] = useState('')
  const [records, setRecords] = useState<RecentData>({ columns: [], records: [] })
  const [values, setValues] = useState<Record<string, string | boolean>>({})
  const [loading, setLoading] = useState(true)
  const [tableLoading, setTableLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    fetch(`/api/hospital/schema?group=${encodeURIComponent(groupId)}`, { credentials: 'include' })
      .then(async (response) => {
        const payload = await response.json() as { group?: TableGroup; error?: string }
        if (!response.ok || !payload.group) throw new Error(payload.error || 'No se pudo cargar el formulario.')
        if (!cancelled) {
          setGroup(payload.group)
          setSelectedName(payload.group.tables[0]?.name || '')
        }
      })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'No se pudo cargar el formulario.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [groupId])

  const selectedTable = useMemo(() => group?.tables.find((table) => table.name === selectedName) || null, [group, selectedName])

  useEffect(() => {
    if (!selectedName) return
    let cancelled = false
    setTableLoading(true)
    setValues({})
    fetch(`/api/hospital/records?table=${encodeURIComponent(selectedName)}`, { credentials: 'include' })
      .then(async (response) => {
        const payload = await response.json() as RecentData & { error?: string }
        if (!response.ok) throw new Error(payload.error || 'No se pudieron cargar los registros.')
        if (!cancelled) setRecords({ columns: payload.columns || [], records: payload.records || [] })
      })
      .catch(() => { if (!cancelled) setRecords({ columns: [], records: [] }) })
      .finally(() => { if (!cancelled) setTableLoading(false) })
    return () => { cancelled = true }
  }, [selectedName])

  async function saveRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedTable) return
    const form = event.currentTarget
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/hospital/records', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table: selectedTable.name, values }),
      })
      const payload = await response.json() as { error?: string }
      if (!response.ok) throw new Error(payload.error || 'No se pudo guardar el registro.')
      setValues({})
      form.reset()
      const refreshed = await fetch(`/api/hospital/records?table=${encodeURIComponent(selectedTable.name)}`, { credentials: 'include' })
      const nextRecords = await refreshed.json() as RecentData
      if (refreshed.ok) setRecords({ columns: nextRecords.columns || [], records: nextRecords.records || [] })
      onSaved(`${selectedTable.label}: registro guardado.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar el registro.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="module-card entry-loading">Preparando el formulario…</div>
  if (error && !group) return <div className="module-card entry-error" role="alert">{error}</div>
  if (!group || !selectedTable) return <div className="module-card empty-state">No hay formularios disponibles en esta sección.</div>

  const generatedColumns = selectedTable.columns.filter((column) => column.identity || column.generated)
  const fields = selectedTable.columns.filter((column) => !column.identity && !column.generated)

  return <div className="data-entry-layout">
    <aside className="entity-picker module-card">
      <span className="eyebrow">REGISTROS</span>
      <h3>{group.label}</h3>
      <div className="entity-picker-list">{group.tables.map((table) => <button key={table.name} className={selectedName === table.name ? 'active' : ''} onClick={() => setSelectedName(table.name)}>
        <span>{table.label}</span><small>{table.columns.filter((column) => !column.identity && !column.generated).length} campos</small>
      </button>)}</div>
    </aside>

    <div className="entity-editor">
      <section className="module-card entity-form-card">
        <div className="module-card-top"><div><span className="eyebrow">{group.label.toLocaleUpperCase('es-GT')}</span><strong>{selectedTable.label}</strong><small>Completa los campos necesarios para registrar este elemento.</small></div></div>
        {generatedColumns.length > 0 && <p className="system-columns">{generatedColumns.map((column) => column.label).join(' · ')} se generan automáticamente.</p>}
        <form className="record-entry-form" onSubmit={saveRecord}>
          {fields.map((column) => <label key={column.name} className={column.dataType === 'text' || column.dataType === 'jsonb' ? 'entry-wide' : ''}>
            <span>{column.label}{column.required && <i> · Requerido</i>}<small className="column-id">{column.name}</small></span>
            {column.choices.length > 0 ? <select required={column.required} value={String(values[column.name] ?? '')} onChange={(event) => setValues((current) => ({ ...current, [column.name]: event.target.value }))}>
              <option value="">Selecciona una opción</option>{column.choices.map((choice) => <option value={choice} key={choice}>{labelFor(choice)}</option>)}
            </select> : column.isForeignKey ? <select required={column.required} value={String(values[column.name] ?? '')} onChange={(event) => setValues((current) => ({ ...current, [column.name]: event.target.value }))}>
              <option value="">Selecciona un registro relacionado</option>{column.referenceOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
            </select> : column.dataType === 'boolean' ? <select value={String(values[column.name] ?? '')} required={column.required} onChange={(event) => setValues((current) => ({ ...current, [column.name]: event.target.value === 'true' }))}>
              <option value="">Selecciona</option><option value="true">Sí</option><option value="false">No</option>
            </select> : column.dataType === 'text' || column.dataType === 'jsonb' ? <textarea rows={3} required={column.required} value={String(values[column.name] ?? '')} onChange={(event) => setValues((current) => ({ ...current, [column.name]: event.target.value }))} /> : <input
              type={inputType(column.dataType)} required={column.required} step={column.dataType.includes('numeric') || column.dataType.includes('decimal') ? 'any' : undefined}
              value={String(values[column.name] ?? '')} onChange={(event) => setValues((current) => ({ ...current, [column.name]: event.target.value }))}
            />}
            {column.defaulted && <small>Opcional: se usa el valor predeterminado si queda vacío.</small>}
            {column.isForeignKey && column.referenceOptions.length === 0 && <small>Registra primero un elemento en la sección correspondiente.</small>}
          </label>)}
          {error && <div className="entry-error entry-wide" role="alert">{error}</div>}
          <div className="entry-actions entry-wide"><button type="submit" className="button button-primary" disabled={saving}>{saving ? 'Guardando…' : `Guardar ${selectedTable.label.toLocaleLowerCase('es-GT')}`}</button></div>
        </form>
      </section>

      <section className="module-card recent-records">
        <div className="module-card-top"><div><strong>Registros recientes</strong><small>{tableLoading ? 'Cargando…' : `Últimos ${records.records.length} registros`}</small></div></div>
        {records.records.length === 0 ? <p className="empty-state">Todavía no hay registros en esta tabla.</p> : <div className="recent-record-list">{records.records.slice(0, 5).map((record, index) => <article key={String(record.id_paciente ?? record.id_consulta ?? record.id_cita ?? index)}>
          {records.columns.slice(0, 4).map((column) => <span key={column}><small>{labelFor(column)}</small><strong>{displayValue(record[column])}</strong></span>)}
        </article>)}</div>}
      </section>
    </div>
  </div>
}
