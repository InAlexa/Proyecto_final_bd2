import { useEffect, useState, type FormEvent } from 'react'
import type { Patient } from '../domain'

type ExamResult = { parametro: string; valor: string; unidad: string; rangoReferencia: string; fueraDeRango: boolean }
type ExamRow = { id: string; patient: string; tipoExamen: string; fecha: string; estado: string; results: ExamResult[] }

const emptyResult = (): ExamResult => ({ parametro: '', valor: '', unidad: '', rangoReferencia: '', fueraDeRango: false })

export function LabExamEntry({ patients, onSaved }: { patients: Patient[]; onSaved: (message: string) => void }) {
  const [exams, setExams] = useState<ExamRow[]>([])
  const [results, setResults] = useState<ExamResult[]>([emptyResult()])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function loadExams() {
    const response = await fetch('/api/lab/exams', { credentials: 'include' })
    const payload = await response.json() as { exams?: ExamRow[]; error?: string }
    if (!response.ok) throw new Error(payload.error || 'No se pudieron cargar los exámenes.')
    setExams(payload.exams || [])
  }

  useEffect(() => { void loadExams().catch((reason) => setError(reason instanceof Error ? reason.message : 'No se pudieron cargar los exámenes.')) }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const validResults = results.filter((result) => result.parametro.trim() && result.valor.trim() && result.unidad.trim())
    if (!validResults.length) {
      setError('Agrega al menos un parámetro con valor y unidad.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/lab/exams', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pacienteId: data.get('pacienteId'),
          tipoExamen: data.get('tipoExamen'),
          medicoSolicitante: data.get('medicoSolicitante'),
          laboratorista: data.get('laboratorista'),
          fechaRealizacion: data.get('fechaRealizacion'),
          estadoExamen: data.get('estadoExamen'),
          resultados: validResults,
          observaciones: data.get('observaciones'),
        }),
      })
      const payload = await response.json() as { error?: string }
      if (!response.ok) throw new Error(payload.error || 'No se pudo guardar el examen.')
      form.reset()
      setResults([emptyResult()])
      await loadExams()
      onSaved('Examen registrado.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar el examen.')
    } finally {
      setSaving(false)
    }
  }

  return <div className="lab-workspace-grid">
    <section className="module-card entity-form-card">
      <div className="module-card-top"><div><span className="eyebrow">NUEVO REGISTRO</span><strong>Orden y resultados</strong><small>Los parámetros se guardan dentro del examen.</small></div></div>
      <form className="record-entry-form" onSubmit={submit}>
        <label className="entry-wide"><span>Paciente · Referencia</span><select name="pacienteId" required defaultValue=""><option value="">Selecciona un paciente</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.name} · {patient.record}</option>)}</select></label>
        <label><span>Tipo de examen</span><input name="tipoExamen" required maxLength={120} placeholder="Ej. Hemograma completo" /></label>
        <label><span>Estado</span><select name="estadoExamen" defaultValue="PENDIENTE"><option>PENDIENTE</option><option>PROCESANDO</option><option>COMPLETADO</option><option>ANULADO</option></select></label>
        <label><span>Médico solicitante</span><input name="medicoSolicitante" maxLength={120} /></label>
        <label><span>Laboratorista</span><input name="laboratorista" maxLength={120} /></label>
        <label className="entry-wide"><span>Fecha de realización</span><input name="fechaRealizacion" type="datetime-local" required /></label>
        <div className="entry-wide result-editor">
          <div className="result-editor-heading"><strong>Parámetros y resultados</strong><button type="button" className="text-button" onClick={() => setResults((current) => [...current, emptyResult()])}>＋ Añadir parámetro</button></div>
          {results.map((result, index) => <div className="result-input-row" key={index}>
            <input aria-label="Parámetro" placeholder="Parámetro" value={result.parametro} onChange={(event) => setResults((current) => current.map((item, i) => i === index ? { ...item, parametro: event.target.value } : item))} />
            <input aria-label="Valor" placeholder="Valor" value={result.valor} onChange={(event) => setResults((current) => current.map((item, i) => i === index ? { ...item, valor: event.target.value } : item))} />
            <input aria-label="Unidad" placeholder="Unidad" value={result.unidad} onChange={(event) => setResults((current) => current.map((item, i) => i === index ? { ...item, unidad: event.target.value } : item))} />
            <input aria-label="Rango de referencia" placeholder="Rango de referencia" value={result.rangoReferencia} onChange={(event) => setResults((current) => current.map((item, i) => i === index ? { ...item, rangoReferencia: event.target.value } : item))} />
            <label className="flag-input"><input type="checkbox" checked={result.fueraDeRango} onChange={(event) => setResults((current) => current.map((item, i) => i === index ? { ...item, fueraDeRango: event.target.checked } : item))} /> Fuera de rango</label>
            {results.length > 1 && <button type="button" className="remove-result" aria-label="Quitar parámetro" onClick={() => setResults((current) => current.filter((_, i) => i !== index))}>×</button>}
          </div>)}
        </div>
        <label className="entry-wide"><span>Observaciones</span><textarea name="observaciones" rows={2} /></label>
        {error && <div className="entry-error entry-wide" role="alert">{error}</div>}
        <div className="entry-actions entry-wide"><button type="submit" className="button button-primary" disabled={saving || !patients.length}>{saving ? 'Guardando…' : 'Guardar examen'}</button></div>
      </form>
    </section>

    <section className="module-card recent-records">
      <div className="module-card-top"><div><span className="eyebrow">HISTORIAL</span><strong>Exámenes recientes</strong><small>{exams.length} registros</small></div></div>
      {exams.length === 0 ? <p className="empty-state">Todavía no hay exámenes registrados.</p> : <div className="recent-record-list">{exams.map((exam) => <article key={exam.id}>
        <span><small>Paciente</small><strong>{exam.patient}</strong></span><span><small>Examen</small><strong>{exam.tipoExamen}</strong></span><span><small>Fecha</small><strong>{new Date(exam.fecha).toLocaleString('es-GT')}</strong></span><span><small>Estado</small><strong>{exam.estado}</strong></span><span><small>Parámetros</small><strong>{exam.results.length}</strong></span>
      </article>)}</div>}
    </section>
  </div>
}
