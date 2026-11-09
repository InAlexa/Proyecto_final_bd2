import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { InstitutionId } from '../domain'

type Field = {
  name: string
  label: string
  type?: 'text' | 'textarea' | 'date' | 'datetime-local' | 'time' | 'number' | 'email' | 'tel' | 'boolean' | 'json' | 'list'
  required?: boolean
  options?: string[]
  help?: string
  referenceCollection?: string
  referenceTable?: string
}
type Entity = { name: string; fields: Field[]; generated?: string[]; helper?: string }
type WorkflowSection = { title: string; entities: Entity[]; summary: string }

const field = (name: string, label: string, type: Field['type'] = 'text', required = true, help?: string, options?: string[]): Field => ({ name, label, type, required, help, options })
const fk = (name: string, label: string, target: string) => ({ ...field(name, label, 'number', true, `Registro relacionado: ${target}.`), referenceTable: target })
const dentalPatient = (label: string) => ({ ...field('paciente_id', label), referenceCollection: 'pacientes' })
const auto = (name: string) => `Se genera automáticamente: ${name}.`

const pediatricSections: Record<string, WorkflowSection> = {
  patients: { title: 'Pacientes y tutores', summary: 'Registra primero a la persona responsable; después crea al menor y añade antecedentes o contactos clínicos.', entities: [
    { name: 'Tutor', generated: ['id_tutor'], fields: [field('cui_dpi','CUI / DPI'),field('nombres','Nombres'),field('apellidos','Apellidos'),field('direccion','Dirección','textarea'),field('fecha_registro','Fecha de registro','datetime-local',false)] },
    { name: 'Teléfono de tutor', generated: ['id_telefono_tutor'], fields: [fk('id_tutor','Tutor','tutor'),field('telefono','Teléfono','tel'),field('tipo','Tipo de teléfono','text',false,'Opcional.',['movil','particular','emergencia','trabajo'])] },
    { name: 'Correo de tutor', generated: ['id_correo_tutor'], fields: [fk('id_tutor','Tutor','tutor'),field('correo','Correo electrónico','email')] },
    { name: 'Paciente menor', generated: ['id_paciente','fecha_registro'], fields: [field('no_expediente','Número de expediente'),fk('id_tutor','Tutor legal','tutor'),field('parentesco_tutor','Parentesco del tutor'),field('nombres','Nombres'),field('apellidos','Apellidos'),field('fecha_nacimiento','Fecha de nacimiento','date'),field('sexo','Sexo','text',true,undefined,['femenino','masculino','otro','no_informado']),field('tipo_sangre','Tipo de sangre','text',false,'Por defecto: desconocido.',['A+','A-','B+','B-','AB+','AB-','O+','O-','desconocido']),field('estado','Estado del expediente','text',false,'Por defecto: activo.',['activo','archivado']),field('fecha_archivo','Fecha de archivo','datetime-local',false),field('motivo_archivo','Motivo de archivo','textarea',false)] },
    { name: 'Antecedente pediátrico', generated: ['id_antecedente','fecha_registro'], fields: [fk('id_paciente','Paciente','paciente'),field('tipo','Tipo','text',true,undefined,['perinatal','neonatal','patologico','familiar','quirurgico','otro']),field('descripcion','Descripción','textarea')] },
    { name: 'Alergia pediátrica', generated: ['id_alergia','fecha_registro'], fields: [fk('id_paciente','Paciente','paciente'),field('sustancia','Sustancia'),field('categoria','Categoría','text',false,'Por defecto: otra.',['farmaco','alimento','ambiental','otra']),field('reaccion','Reacción','textarea'),field('gravedad','Gravedad','text',false,'Por defecto: desconocida.',['leve','moderada','grave','desconocida'])] },
  ] },
  agenda: { title: 'Agenda', summary: 'Programa una cita con paciente y pediatra. Las referencias se escriben con los IDs creados en sus respectivos apartados.', entities: [
    { name: 'Cita', generated: ['id_cita','id_pediatra_vigente','id_paciente_vigente'], fields: [fk('id_paciente','Paciente','paciente'),fk('id_pediatra','Pediatra','pediatra'),field('fecha','Fecha','date'),field('hora','Hora','time'),field('tipo_cita','Tipo de cita','text',false,'Por defecto: morbilidad.',['nino_sano','morbilidad','vacunacion','seguimiento']),field('motivo','Motivo','textarea'),field('estado','Estado','text',false,'Por defecto: programada.',['programada','confirmada','atendida','cancelada','no_asistio'])] },
  ] },
  care: { title: 'Consulta y crecimiento', summary: 'Captura la consulta y su control antropométrico por separado; el IMC se calcula en la base de datos.', entities: [
    { name: 'Consulta', generated: ['id_consulta','fecha_hora'], fields: [fk('id_paciente','Paciente','paciente'),fk('id_pediatra','Pediatra','pediatra'),field('tipo','Tipo de consulta','text',false,'Por defecto: externa.',['externa','urgencia','seguimiento']),field('motivo_consulta','Motivo de consulta','textarea'),field('examen_fisico','Examen físico','textarea'),field('observaciones','Observaciones','textarea',false),field('estado','Estado','text',false,'Por defecto: borrador.',['borrador','cerrada'])] },
    { name: 'Vínculo cita-consulta', fields: [fk('id_cita','Cita','cita'),fk('id_consulta','Consulta','consulta')] },
    { name: 'Control de crecimiento', generated: ['id_control','fecha_hora','imc'], fields: [fk('id_consulta','Consulta','consulta'),fk('id_enfermero','Enfermería','personal_enfermeria'),field('edad_meses','Edad en meses','number'),field('peso_kg','Peso (kg)','number'),field('talla_cm','Talla (cm)','number'),field('perimetro_cefalico_cm','Perímetro cefálico (cm)','number',false),field('percentil_peso','Percentil de peso','number',false),field('percentil_talla','Percentil de talla','number',false),field('estado_nutricional','Estado nutricional','text',false,undefined,['desnutricion','bajo_peso','normal','sobrepeso','obesidad'])] },
  ] },
  vaccines: { title: 'Vacunación', summary: 'Mantén el catálogo de vacunas y registra cada dosis aplicada con lote, paciente y responsable.', entities: [
    { name: 'Vacuna', generated: ['id_vacuna'], fields: [field('nombre','Nombre'),field('enfermedad_prevenida','Enfermedad prevenida'),field('edad_recomendada_meses','Edad recomendada (meses)','number'),field('dosis_total','Dosis totales','number')] },
    { name: 'Dosis aplicada', generated: ['id_vacunacion','fecha_aplicacion'], fields: [fk('id_paciente','Paciente','paciente'),fk('id_vacuna','Vacuna','vacuna'),fk('id_enfermero','Enfermería','personal_enfermeria'),field('dosis_aplicada','Número de dosis','number'),field('lote','Lote'),field('centro_aplicacion','Centro de aplicación','text',false,'Por defecto: Centro Médico Pediátrico.'),field('reacciones_adversas','Reacciones adversas','textarea',false)] },
  ] },
  prescriptions: { title: 'Diagnósticos y recetas', summary: 'Relaciona los diagnósticos y medicamentos con la consulta; la dosis incluye peso y pauta pediátrica.', entities: [
    { name: 'Diagnóstico', generated: ['id_diagnostico','fecha_registro'], fields: [fk('id_consulta','Consulta','consulta'),field('codigo_cie','Código CIE'),field('nombre','Nombre'),field('clasificacion','Clasificación','text',false,'Por defecto: presuntivo.',['presuntivo','definitivo']),field('descripcion','Descripción','textarea')] },
    { name: 'Receta', generated: ['id_receta','fecha_emision'], fields: [fk('id_consulta','Consulta','consulta'),field('indicaciones_generales','Indicaciones generales','textarea',false)] },
    { name: 'Medicamento recetado', generated: ['id_detalle'], fields: [fk('id_receta','Receta','receta'),fk('id_medicamento','Medicamento','medicamento'),field('dosis','Dosis'),field('via_administracion','Vía de administración'),field('frecuencia','Frecuencia'),field('duracion_dias','Duración (días)','number'),field('peso_base_calculo_kg','Peso base de cálculo (kg)','number'),field('indicaciones','Indicaciones','textarea',false)] },
  ] },
  catalogs: { title: 'Personal y catálogos', summary: 'Crea personal, especialidades y productos antes de usarlos en citas, controles y recetas.', entities: [
    { name: 'Especialidad', generated: ['id_especialidad'], fields: [field('nombre','Nombre')] },
    { name: 'Pediatra', generated: ['id_pediatra'], fields: [field('nombres','Nombres'),field('apellidos','Apellidos'),field('colegiado','Colegiado'),field('activo','Activo','boolean',false,'Por defecto: sí.')] },
    { name: 'Especialidad de pediatra', fields: [fk('id_pediatra','Pediatra','pediatra'),fk('id_especialidad','Especialidad','especialidad')] },
    { name: 'Teléfono de pediatra', generated: ['id_telefono_pediatra'], fields: [fk('id_pediatra','Pediatra','pediatra'),field('telefono','Teléfono','tel'),field('tipo','Tipo','text',false,undefined,['movil','particular','institucional'])] },
    { name: 'Correo de pediatra', generated: ['id_correo_pediatra'], fields: [fk('id_pediatra','Pediatra','pediatra'),field('correo','Correo','email')] },
    { name: 'Personal de enfermería', generated: ['id_enfermero'], fields: [field('nombres','Nombres'),field('apellidos','Apellidos'),field('registro_profesional','Registro profesional'),field('turno','Turno','text',true,undefined,['matutino','vespertino','nocturno']),field('activo','Activo','boolean',false,'Por defecto: sí.')] },
    { name: 'Medicamento', generated: ['id_medicamento'], fields: [field('nombre_comercial','Nombre comercial'),field('principio_activo','Principio activo'),field('presentacion','Presentación'),field('concentracion_pediatrica','Concentración pediátrica')] },
  ] },
  exchange: { title: 'Intercambio', summary: 'Registra la procedencia del dato y la finalidad de cada intercambio entre instituciones.', entities: [
    { name: 'Institución externa', generated: ['id_institucion'], fields: [field('nombre','Nombre'),field('tipo','Tipo','text',true,undefined,['hospital','clinica_odontologica','laboratorio','centro_pediatrico'])] },
    { name: 'Identificador externo de paciente', generated: ['id_paciente_institucion','fecha_vinculo'], fields: [fk('id_paciente','Paciente local','paciente'),fk('id_institucion','Institución externa','institucion'),field('id_local_externo','ID local externo'),field('verificado','Verificado','boolean',false,'Por defecto: no.')] },
    { name: 'Documento externo', generated: ['id_documento','fecha_recepcion'], fields: [fk('id_paciente','Paciente','paciente'),field('id_consulta','Consulta vinculada (opcional)','number',false),fk('id_institucion_origen','Institución de origen','institucion'),field('id_documento_origen','ID de documento de origen'),field('tipo_documento','Tipo de documento'),field('fecha_emision','Fecha de emisión','datetime-local'),field('contenido','Contenido','textarea')] },
    { name: 'Bitácora de intercambio', generated: ['id_intercambio','fecha_hora'], fields: [fk('id_paciente','Paciente','paciente'),fk('id_institucion','Institución','institucion'),field('usuario','Usuario'),field('accion','Acción','text',true,undefined,['solicito','consulto','compartio','recibio']),field('finalidad','Finalidad')] },
    { name: 'Bitácora de auditoría', generated: ['id_auditoria','fecha_hora'], fields: [field('tabla','Tabla afectada'),field('id_registro','ID del registro','number'),field('accion','Acción','text',true,undefined,['INSERT','UPDATE','DELETE','CORRECCION']),field('usuario','Usuario'),field('motivo','Motivo','textarea',false),field('valor_anterior','Valor anterior (JSON)','json',false),field('valor_nuevo','Valor nuevo (JSON)','json',false)] },
  ] },
}

const dentalSections: Record<string, WorkflowSection> = {
  patients: { title: 'Expediente y anamnesis', summary: 'La ficha personal y la anamnesis quedan juntas; los contactos de emergencia y alergias se registran aquí.', entities: [
    { name: 'Paciente', generated: ['fecha_creacion'], fields: [field('document_id','ID del documento','text',false,'Opcional. Si se deja vacío, se genera automáticamente.'),field('identificacion.tipo','Tipo de identificación','text',true,undefined,['DPI','Pasaporte','Otro']),field('identificacion.numero','Número de identificación'),field('nombres','Nombres'),field('apellidos','Apellidos'),field('fecha_nacimiento','Fecha de nacimiento','date'),field('sexo','Sexo','text',true,undefined,['femenino','masculino','otro','no_informado']),field('telefono','Teléfono','tel'),field('correo','Correo electrónico','email',false),field('direccion','Dirección','textarea',false),field('contacto_emergencia.nombre','Contacto de emergencia','text',false),field('contacto_emergencia.parentesco','Parentesco','text',false),field('contacto_emergencia.telefono','Teléfono de emergencia','tel',false),field('anamnesis_medica.alergias_anestesicos','Alergias a anestésicos (separadas por comas)','list',false),field('anamnesis_medica.condiciones_sistemicas','Condiciones sistémicas (separadas por comas)','list',false),field('anamnesis_medica.medicamentos_actuales','Medicamentos actuales (separados por comas)','list',false),field('anamnesis_medica.embarazo','Embarazo','boolean',false),field('anamnesis_medica.notas','Notas de anamnesis','textarea',false),field('activo','Activo','boolean',false,'Por defecto: sí.')], helper: auto('fecha_creacion') },
  ] },
  agenda: { title: 'Agenda odontológica', summary: 'Cada turno mantiene su propio estado y referencia al expediente del paciente.', entities: [
    { name: 'Cita odontológica', fields: [field('document_id','ID del documento','text',false,'Opcional. Si se deja vacío, se genera automáticamente.'),dentalPatient('Paciente'),field('odontologo_id','ID del odontólogo'),field('odontologo_nombre','Nombre del odontólogo'),field('fecha_programada','Fecha y hora','datetime-local'),field('duracion_minutos','Duración (minutos)','number'),field('estado_cita','Estado','text',true,undefined,['PROGRAMADA','CONFIRMADA','EN_ATENCION','COMPLETADA','CANCELADA','NO_ASISTIO']),field('motivo','Motivo','textarea'),field('sala_sillon_asignado','Sala o sillón'),field('notas','Notas','textarea',false)] },
  ] },
  'dental-record': { title: 'Odontograma e historial', summary: 'El estado actual de cada pieza se guarda en el odontograma; sesiones clínicas se añaden como arreglo de eventos.', entities: [
    { name: 'Historial odontológico', generated: ['ultima_actualizacion'], fields: [field('document_id','ID del documento','text',false,'Opcional. Si se deja vacío, se genera automáticamente.'),dentalPatient('Paciente'),field('numero_expediente','Número de expediente'),field('odontograma_general','Odontograma general (JSON)','json',true,'Ejemplo: {"11":{"estado":"SANO"}}.'),field('sesiones_clinicas','Sesiones clínicas (JSON)','json',false,'Arreglo de sesiones; cada sesión puede guardar diagnóstico, procedimiento, insumos, receta y costo.')] },
  ] },
}

const entityTargets: Record<InstitutionId, Record<string, string>> = {
  hospital: {}, laboratorio: {},
  pediatria: {
    'Tutor': 'tutor', 'Teléfono de tutor': 'telefono_tutor', 'Correo de tutor': 'correo_tutor', 'Paciente menor': 'paciente',
    'Antecedente pediátrico': 'antecedente_paciente', 'Alergia pediátrica': 'alergia_paciente', 'Cita': 'cita', 'Consulta': 'consulta',
    'Vínculo cita-consulta': 'cita_consulta', 'Control de crecimiento': 'control_crecimiento', 'Vacuna': 'vacuna', 'Dosis aplicada': 'registro_vacunacion',
    'Diagnóstico': 'diagnostico', 'Receta': 'receta', 'Medicamento recetado': 'detalle_receta', 'Especialidad': 'especialidad',
    'Pediatra': 'pediatra', 'Especialidad de pediatra': 'pediatra_especialidad', 'Teléfono de pediatra': 'telefono_pediatra',
    'Correo de pediatra': 'correo_pediatra', 'Personal de enfermería': 'personal_enfermeria', 'Medicamento': 'medicamento',
    'Institución externa': 'institucion', 'Identificador externo de paciente': 'paciente_institucion', 'Documento externo': 'documento_externo',
    'Bitácora de intercambio': 'bitacora_intercambio', 'Bitácora de auditoría': 'bitacora_auditoria',
  },
  odontologia: { 'Paciente': 'pacientes', 'Cita odontológica': 'citas_odontologicas', 'Historial odontológico': 'historiales_odontologicos' },
}

type StoredRecord = { id: string; data: Record<string, unknown> }

function PediatricEncounter({onSaved}:{onSaved?:(message:string)=>void}) {
  const [options,setOptions]=useState<{patients:{id:number;label:string}[];doctors:{id:number;label:string}[];nurses:{id:number;label:string}[];medicines:{id:number;label:string}[];consultations:{id:number;label:string}[];appointments:{id:number;label:string}[]}>({patients:[],doctors:[],nurses:[],medicines:[],consultations:[],appointments:[]});const [error,setError]=useState('');const [saving,setSaving]=useState(false)
  useEffect(()=>{let cancelled=false;fetch('/api/pediatria/options',{credentials:'include'}).then(async r=>{const p=await r.json();if(!r.ok)throw new Error(p.error);if(!cancelled)setOptions(p)}).catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:'No se cargaron catálogos')});return()=>{cancelled=true}},[])
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=e.currentTarget;const d=new FormData(f);setSaving(true);setError('');try{const r=await fetch('/api/clinical/encounter',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({institutionId:'pediatria',patientId:d.get('patientId'),doctorId:d.get('doctorId'),appointmentId:d.get('appointmentId'),motivo:d.get('motivo'),examenFisico:d.get('examenFisico'),diagnostico:d.get('diagnostico'),codigoCie:d.get('codigoCie'),nombreDiagnostico:d.get('nombreDiagnostico'),clasificacion:d.get('clasificacion'),nurseId:d.get('nurseId'),weight:d.get('weight'),height:d.get('height'),headCircumference:d.get('headCircumference'),medicineId:d.get('medicineId'),dosis:d.get('dosis'),via:d.get('via'),frecuencia:d.get('frecuencia'),duracion:d.get('duracion'),indicaciones:d.get('indicaciones')})});const p=await r.json();if(!r.ok)throw new Error(p.error);f.reset();onSaved?.('Consulta pediátrica registrada con sus datos clínicos.')}catch(x){setError(x instanceof Error?x.message:'No se pudo guardar')}finally{setSaving(false)}}
  return <section className="module-card entity-form-card"><div className="module-card-top"><div><span className="eyebrow">ATENCIÓN PEDIÁTRICA</span><strong>Consulta, crecimiento y plan clínico</strong><small>Guarda todo el encuentro junto; se aplican controles por peso y alergias definidos por MySQL.</small></div></div><form className="record-entry-form" onSubmit={submit}><label><span>Paciente</span><select name="patientId" required><option value="">Selecciona</option>{options.patients.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select></label><label><span>Pediatra</span><select name="doctorId" required><option value="">Selecciona</option>{options.doctors.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select></label><label className="entry-wide"><span>Cita asociada (opcional; urgencia sin cita)</span><select name="appointmentId"><option value="">Sin cita</option>{options.appointments.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select></label><label><span>Motivo</span><input name="motivo" required /></label><label><span>Examen físico</span><input name="examenFisico" required /></label><label className="entry-wide"><span>Diagnóstico clínico</span><textarea name="diagnostico" required /></label><label><span>Código CIE</span><input name="codigoCie" defaultValue="Z00.0" required /></label><label><span>Nombre de diagnóstico</span><input name="nombreDiagnostico" required /></label><label><span>Clasificación</span><select name="clasificacion"><option>definitivo</option><option>presuntivo</option></select></label><label><span>Enfermería (para crecimiento)</span><select name="nurseId"><option value="">Sin control</option>{options.nurses.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select></label><label><span>Peso (kg)</span><input name="weight" type="number" step="0.01" min="0.1" /></label><label><span>Talla (cm)</span><input name="height" type="number" step="0.1" min="1" /></label><label><span>Perímetro cefálico (cm)</span><input name="headCircumference" type="number" step="0.1" /></label><label><span>Medicamento</span><select name="medicineId"><option value="">Sin receta</option>{options.medicines.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select></label><label><span>Dosis</span><input name="dosis" /></label><label><span>Vía</span><input name="via" /></label><label><span>Frecuencia</span><input name="frecuencia" /></label><label><span>Duración (días)</span><input name="duracion" type="number" min="1" /></label><label className="entry-wide"><span>Indicaciones</span><textarea name="indicaciones" /></label>{error&&<div className="entry-error entry-wide" role="alert">{error}</div>}<div className="entry-actions entry-wide"><button className="button button-primary" disabled={saving}>{saving?'Guardando…':'Guardar encuentro pediátrico'}</button></div></form></section>
}

function OdontologiaTreatment({patients,onSaved}:{patients:StoredRecord[];onSaved?: (message:string)=>void}) {
  const [appointments,setAppointments]=useState<StoredRecord[]>([]);const [error,setError]=useState('');const [saving,setSaving]=useState(false)
  async function load(){const p=await loadDentalCollection('citas_odontologicas');setAppointments(p.filter(a=>['PROGRAMADA','CONFIRMADA','EN_ATENCION'].includes(String(a.data.estado_cita))))}
  useEffect(()=>{void load().catch(e=>setError(e instanceof Error?e.message:'No se pudieron cargar las citas.'))},[])
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const f=event.currentTarget;const d=new FormData(f);let patch:Record<string,unknown>;try{patch=JSON.parse(String(d.get('odontograma')||'{}')) as Record<string,unknown>}catch{setError('El odontograma debe ser JSON válido.');return}setSaving(true);setError('');try{const response=await fetch('/api/odontologia/treatment',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({appointmentId:d.get('appointmentId'),patientId:d.get('patientId'),diagnostico:d.get('diagnostico'),procedimiento:d.get('procedimiento'),odontogramaPatch:patch,insumos:String(d.get('insumos')||'').split(',').map(x=>x.trim()).filter(Boolean),receta:String(d.get('medicamento')||'').trim()?[{medicamento:d.get('medicamento'),dosis:d.get('dosis'),frecuencia:d.get('frecuencia'),duracion:d.get('duracion')}]:[],costo:Number(d.get('costo')||0)})});const p=await response.json() as {error?:string};if(!response.ok)throw new Error(p.error||'No se pudo guardar');f.reset();await load();onSaved?.('Sesión odontológica registrada y cita completada.')}catch(e){setError(e instanceof Error?e.message:'No se pudo guardar la sesión.')}finally{setSaving(false)}}
  return <div className="module-card entity-form-card"><div className="module-card-top"><div><span className="eyebrow">REGISTRO ATÓMICO</span><strong>Tratamiento odontológico</strong><small>La sesión, el odontograma y el estado de la cita se actualizan juntos.</small></div></div><form className="record-entry-form" onSubmit={submit}><label className="entry-wide"><span>Paciente</span><select name="patientId" required defaultValue=""><option value="">Selecciona paciente</option>{patients.map(p=><option value={p.id} key={p.id}>{String(p.data.nombres||'')} {String(p.data.apellidos||'')} · {p.id}</option>)}</select></label><label className="entry-wide"><span>Cita pendiente</span><select name="appointmentId" required defaultValue=""><option value="">Selecciona cita</option>{appointments.map(a=><option key={a.id} value={a.id}>{String(a.data.fecha_programada||'')} · {String(a.data.odontologo_nombre||'')} · {String(a.data.motivo||'')}</option>)}</select></label><label><span>Diagnóstico</span><input name="diagnostico" required /></label><label><span>Procedimiento</span><input name="procedimiento" required /></label><label className="entry-wide"><span>Cambios del odontograma (JSON)</span><textarea name="odontograma" rows={4} defaultValue="{}" required /></label><label><span>Insumos (separados por coma)</span><input name="insumos" /></label><label><span>Costo de sesión</span><input name="costo" type="number" min="0" step="0.01" defaultValue="0" /></label><label><span>Medicamento</span><input name="medicamento" /></label><label><span>Dosis</span><input name="dosis" /></label><label><span>Frecuencia</span><input name="frecuencia" /></label><label><span>Duración</span><input name="duracion" /></label>{error&&<div role="alert" className="entry-error entry-wide">{error}</div>}<div className="entry-actions entry-wide"><button disabled={saving} className="button button-primary">{saving?'Guardando…':'Guardar sesión clínica'}</button></div></form></div>
}

async function loadDentalCollection(collection: string): Promise<StoredRecord[]> {
  const response = await fetch(`/api/odontologia/records?collection=${encodeURIComponent(collection)}`, { credentials: 'include' })
  const payload = await response.json() as { records?: StoredRecord[]; error?: string }
  if (!response.ok) throw new Error(payload.error || 'No se pudieron cargar los registros.')
  return payload.records || []
}

async function loadPediatricTable(table: string): Promise<StoredRecord[]> {
  const response = await fetch(`/api/pediatria/records?table=${encodeURIComponent(table)}`, { credentials: 'include' })
  const payload = await response.json() as { records?: StoredRecord[]; error?: string }
  if (!response.ok) throw new Error(payload.error || 'No se pudieron cargar los registros.')
  return payload.records || []
}

function parseValue(raw: string, field: Field): unknown {
  if (field.type === 'number') return raw === '' ? '' : Number(raw)
  if (field.type === 'boolean') return raw === 'true'
  if (field.type === 'json') return raw.trim() ? JSON.parse(raw) as unknown : null
  if (field.type === 'list') return raw.split(',').map((value) => value.trim()).filter(Boolean)
  return raw
}

function assignPath(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.')
  let current = target
  parts.forEach((part, index) => {
    if (index === parts.length - 1) current[part] = value
    else {
      const next = current[part]
      if (!next || typeof next !== 'object' || Array.isArray(next)) current[part] = {}
      current = current[part] as Record<string, unknown>
    }
  })
}

export function InstitutionWorkflow({ institution, section, onSaved }: { institution: InstitutionId; section: string; onSaved?: (message: string) => void }) {
  if(institution==='pediatria'&&section==='care') return <PediatricEncounter onSaved={onSaved}/>
  const workflow = useMemo(() => institution === 'pediatria' ? pediatricSections[section] : institution === 'odontologia' ? dentalSections[section] : undefined, [institution, section])
  const [selectedName, setSelectedName] = useState('')
  const [prepared, setPrepared] = useState('')
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [records, setRecords] = useState<StoredRecord[]>([])
  const [references, setReferences] = useState<Record<string, StoredRecord[]>>({})
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const entity = workflow?.entities.find((item) => item.name === selectedName) || workflow?.entities[0]
  const collectionName = entity ? entityTargets[institution][entity.name] : ''
  const referenceCollections = [...new Set((entity?.fields || []).flatMap((item) => item.referenceCollection ? [item.referenceCollection] : []))]
  const referenceTables = [...new Set((entity?.fields || []).flatMap((item) => item.referenceTable ? [item.referenceTable] : []))]
  const [dentalPatients,setDentalPatients]=useState<StoredRecord[]>([])
  const [pediatricReferences,setPediatricReferences]=useState<Record<string,{id:string;label:string}[]>>({})

  useEffect(() => {
    if (!collectionName || (institution !== 'odontologia' && institution !== 'pediatria')) return
    let cancelled = false
    setRecordsLoading(true)
    setLoadError('')
    const loader = institution === 'odontologia' ? loadDentalCollection(collectionName) : loadPediatricTable(collectionName)
    loader
      .then((nextRecords) => { if (!cancelled) setRecords(nextRecords) })
      .catch((reason) => { if (!cancelled) { setRecords([]); setLoadError(reason instanceof Error ? reason.message : 'No se pudieron cargar los registros.') } })
      .finally(() => { if (!cancelled) setRecordsLoading(false) })
    return () => { cancelled = true }
  }, [institution, collectionName])

  useEffect(() => {
    if (institution !== 'odontologia' || referenceCollections.length === 0) {
      setReferences({})
      return
    }
    let cancelled = false
    Promise.all(referenceCollections.map(async (collection) => [collection, await loadDentalCollection(collection)] as const))
      .then((entries) => { if (!cancelled) setReferences(Object.fromEntries(entries)) })
      .catch(() => { if (!cancelled) setReferences({}) })
    return () => { cancelled = true }
  }, [institution, referenceCollections.join('|')])

  useEffect(()=>{if(institution!=='odontologia'||section!=='dental-record')return;let cancelled=false;void loadDentalCollection('pacientes').then(rows=>{if(!cancelled)setDentalPatients(rows)}).catch(()=>undefined);return()=>{cancelled=true}},[institution,section])

  useEffect(()=>{if(institution!=='pediatria'||referenceTables.length===0){setPediatricReferences({});return}let cancelled=false;Promise.all(referenceTables.map(async table=>{const response=await fetch(`/api/pediatria/lookup?table=${encodeURIComponent(table)}`,{credentials:'include'});const payload=await response.json() as {options?:{id:string;label:string}[];error?:string};if(!response.ok)throw new Error(payload.error||'No se pudieron cargar las referencias.');return [table,payload.options||[]] as const})).then(entries=>{if(!cancelled)setPediatricReferences(Object.fromEntries(entries))}).catch(reason=>{if(!cancelled)setLoadError(reason instanceof Error?reason.message:'No se pudieron cargar las referencias.')});return()=>{cancelled=true}},[institution,referenceTables.join('|')])

  if (!workflow || !entity) return <div className="module-card empty-state">No hay formularios en este apartado.</div>
  if(institution==='odontologia'&&section==='dental-record') return <div className="data-entry-layout"><aside className="entity-picker module-card"><span className="eyebrow">HISTORIA DENTAL</span><h3>Odontograma y sesiones</h3><p className="section-description">El odontograma y las sesiones se mantienen embebidos; las citas permanecen referenciadas por paciente.</p></aside><OdontologiaTreatment patients={dentalPatients} onSaved={onSaved}/></div>
  const activeEntity = entity

  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const output: Record<string, unknown> = {}
    let documentId = ''
    try {
      activeEntity.fields.forEach((item) => {
        const raw = item.type === 'boolean' ? (data.get(item.name) === 'on' ? 'true' : 'false') : String(data.get(item.name) ?? '')
        if (!raw && !item.required) return
        const value = parseValue(raw, item)
        if (item.name === 'document_id') documentId = String(value)
        else assignPath(output, item.name, value)
      })
      const target = entityTargets[institution][activeEntity.name]
      const preparedRecord = institution === 'odontologia'
        ? { collection: target, documentId: documentId || null, data: output }
        : { table: target, values: output }
      setPrepared(JSON.stringify(preparedRecord, null, 2))
      setError('')
    } catch {
      setError('Revisa el formato JSON antes de preparar el registro.')
      setPrepared('')
    }
  }

  async function saveDentalRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const data: Record<string, unknown> = {}
    let documentId = ''
    try {
      activeEntity.fields.forEach((item) => {
        const raw = item.type === 'boolean' ? (formData.get(item.name) === 'on' ? 'true' : 'false') : String(formData.get(item.name) ?? '')
        if (!raw && !item.required) return
        if (item.name === 'document_id') {
          documentId = raw.trim()
          return
        }
        if (item.type === 'datetime-local' && raw) {
          const date = new Date(raw)
          if (Number.isNaN(date.getTime())) throw new Error('Revisa la fecha y hora.')
          assignPath(data, item.name, date.toISOString())
          return
        }
        assignPath(data, item.name, parseValue(raw, item))
      })
      setSaving(true)
      setError('')
      const response = await fetch('/api/odontologia/records', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection: collectionName, documentId: documentId || undefined, data }),
      })
      const payload = await response.json() as { id?: string; error?: string }
      if (!response.ok) throw new Error(payload.error || 'No se pudo guardar el registro.')
      form.reset()
      setPrepared('')
      setRecords(await loadDentalCollection(collectionName))
      onSaved?.(`${activeEntity.name}: registro guardado.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar el registro.')
    } finally {
      setSaving(false)
    }
  }

  async function savePediatricRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const values: Record<string, unknown> = {}
    try {
      activeEntity.fields.forEach((item) => {
        const raw = item.type === 'boolean' ? (formData.get(item.name) === 'on' ? 'true' : 'false') : String(formData.get(item.name) ?? '')
        if (!raw && !item.required) return
        values[item.name] = parseValue(raw, item)
      })
      setSaving(true)
      setError('')
      const response = await fetch('/api/pediatria/records', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table: collectionName, values }),
      })
      const payload = await response.json() as { error?: string }
      if (!response.ok) throw new Error(payload.error || 'No se pudo guardar el registro.')
      form.reset()
      setPrepared('')
      setRecords(await loadPediatricTable(collectionName))
      onSaved?.(`${activeEntity.name}: registro guardado en MySQL.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar el registro.')
    } finally {
      setSaving(false)
    }
  }

  async function copyPrepared() {
    await navigator.clipboard.writeText(prepared)
  }

  return <div className="pending-workflow-layout">
    <aside className="entity-picker module-card">
      <span className="eyebrow">ENTIDADES</span><h3>{workflow.title}</h3>
      <p className="section-description">{workflow.summary}</p>
      <div className="entity-picker-list">{workflow.entities.map((item) => <button key={item.name} className={item.name === activeEntity.name ? 'active' : ''} onClick={() => { setSelectedName(item.name); setPrepared(''); setError('') }}><span>{item.name}</span><small>{item.fields.length} campos</small></button>)}</div>
    </aside>
    <section className="module-card entity-form-card">
      <div className="module-card-top"><div><span className="eyebrow">{workflow.title.toLocaleUpperCase('es-GT')}</span><strong>{activeEntity.name}</strong><small>Registro: {entityTargets[institution][activeEntity.name]}</small></div></div>
      {activeEntity.generated?.length ? <p className="system-columns">Automáticos: {activeEntity.generated.join(' · ')}.</p> : null}
      {activeEntity.helper && <p className="system-columns">{activeEntity.helper}</p>}
      <form className="record-entry-form" key={activeEntity.name} onSubmit={institution === 'odontologia' ? saveDentalRecord : institution === 'pediatria' ? savePediatricRecord : prepare}>
        {activeEntity.fields.map((item) => <label key={item.name} className={item.type === 'textarea' || item.type === 'json' ? 'entry-wide' : ''}>
          <span>{item.label}{item.required && <i> · Requerido</i>}<small className="column-id">{item.name}</small></span>
          {item.referenceCollection ? <select name={item.name} required={item.required} defaultValue=""><option value="">Selecciona un paciente</option>{(references[item.referenceCollection] || []).map((record) => {
              const patientName = `${String(record.data.nombres || '')} ${String(record.data.apellidos || '')}`.trim() || record.id
              return <option key={record.id} value={record.id}>{patientName} · {record.id}</option>
            })}</select>
            : item.referenceTable ? <select name={item.name} required={item.required} defaultValue=""><option value="">Selecciona {item.label.toLocaleLowerCase('es-GT')}</option>{(pediatricReferences[item.referenceTable]||[]).map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select>
            : item.options ? <select name={item.name} required={item.required} defaultValue=""><option value="">Selecciona una opción</option>{item.options.map((option) => <option key={option}>{option}</option>)}</select>
            : item.type === 'boolean' ? <input name={item.name} type="checkbox" className="entry-checkbox" defaultChecked={item.help?.includes('Por defecto: sí')} />
            : item.type === 'textarea' || item.type === 'json' ? <textarea name={item.name} rows={item.type === 'json' ? 5 : 3} required={item.required} placeholder={item.type === 'json' ? '{ }' : undefined} />
            : <input name={item.name} type={item.type === 'list' ? 'text' : item.type || 'text'} required={item.required} step={item.type === 'number' ? 'any' : undefined} />}
          {item.help && <small>{item.help}</small>}
        </label>)}
        {institution === 'pediatria' && <div className="form-note entry-wide">Los datos se guardarán en la base del Centro Médico Pediátrico.</div>}
        {institution !== 'odontologia' && institution !== 'pediatria' && <div className="pending-save-note entry-wide">Puedes completar la estructura y preparar el contenido. El guardado en esta institución se activará al terminar su conexión.</div>}
        {loadError && <div className="entry-error entry-wide" role="alert">{loadError}</div>}
        {error && <div className="entry-error entry-wide" role="alert">{error}</div>}
        <div className="entry-actions entry-wide"><button type="submit" className="button button-primary" disabled={saving}>{saving ? 'Guardando…' : institution === 'odontologia' || institution === 'pediatria' ? `Guardar ${activeEntity.name.toLocaleLowerCase('es-GT')}` : 'Preparar registro'}</button></div>
      </form>
      {prepared && <div className="prepared-record entry-wide"><div><strong>Registro preparado</strong><button type="button" className="text-button" onClick={() => void copyPrepared()}>Copiar JSON</button></div><pre>{prepared}</pre></div>}
      {(institution === 'odontologia' || institution === 'pediatria') && <section className="recent-records module-card">
        <div className="module-card-top"><div><strong>Registros actuales</strong><small>{recordsLoading ? 'Cargando…' : `${records.length} ${institution === 'odontologia' ? 'documentos' : 'registros'}`}</small></div></div>
        {loadError ? <p className="empty-state">{loadError}</p> : records.length === 0 ? <p className="empty-state">Todavía no hay registros en este apartado.</p> : <div className="recent-record-list">{records.map((record) => {
          const label = `${String(record.data.nombres || '')} ${String(record.data.apellidos || '')}`.trim() || String(record.data.motivo || record.data.numero_expediente || record.data.odontologo_nombre || 'Registro')
          return <article key={record.id}><span><small>ID del documento</small><strong>{record.id}</strong></span><span><small>Detalle</small><strong>{label}</strong></span><span><small>Fecha</small><strong>{String(record.data.fecha_programada || record.data.fecha_creacion || record.data.ultima_actualizacion || '—')}</strong></span></article>
        })}</div>}
      </section>}
    </section>
  </div>
}
