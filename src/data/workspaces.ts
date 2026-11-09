import type { InstitutionId } from '../domain'

export type WorkspaceSection = { id: string; label: string; description: string }

export const workspaceSections: Record<InstitutionId, WorkspaceSection[]> = {
  hospital: [
    { id: 'overview', label: 'Resumen', description: 'Actividad y seguimiento hospitalario.' },
    { id: 'patients', label: 'Pacientes', description: 'Expedientes, contacto y datos de identificación.' },
    { id: 'agenda', label: 'Agenda', description: 'Citas, pacientes y profesionales asignados.' },
    { id: 'care', label: 'Atención', description: 'Consultas, evaluaciones físicas y hospitalizaciones.' },
    { id: 'history', label: 'Historial clínico', description: 'Antecedentes, alergias, diagnósticos y tratamientos.' },
    { id: 'catalogs', label: 'Catálogos', description: 'Personal, especialidades y medicamentos.' },
  ],
  pediatria: [
    { id: 'overview', label: 'Resumen', description: 'Actividad pediátrica y seguimiento.' },
    { id: 'patients', label: 'Pacientes y tutores', description: 'Menores, tutores legales y sus contactos.' },
    { id: 'agenda', label: 'Agenda', description: 'Citas pediátricas y turnos.' },
    { id: 'care', label: 'Consulta y crecimiento', description: 'Consultas, triaje y somatometría.' },
    { id: 'vaccines', label: 'Vacunación', description: 'Esquema, dosis aplicadas y trazabilidad.' },
    { id: 'prescriptions', label: 'Diagnósticos y recetas', description: 'Diagnóstico clínico y prescripción por peso.' },
    { id: 'catalogs', label: 'Personal y catálogos', description: 'Pediatras, enfermería, vacunas y medicamentos.' },
    { id: 'exchange', label: 'Intercambio', description: 'Instituciones, documentos y trazabilidad.' },
  ],
  laboratorio: [
    { id: 'overview', label: 'Resumen', description: 'Órdenes y resultados recientes.' },
    { id: 'patients', label: 'Pacientes', description: 'Identificación y contacto del paciente.' },
    { id: 'exams', label: 'Exámenes y resultados', description: 'Solicitudes, analitos y validación de resultados.' },
  ],
  odontologia: [
    { id: 'overview', label: 'Resumen', description: 'Agenda y actividad odontológica.' },
    { id: 'patients', label: 'Pacientes', description: 'Datos personales, contacto y anamnesis.' },
    { id: 'agenda', label: 'Agenda', description: 'Citas, profesional, duración y sillón.' },
    { id: 'dental-record', label: 'Odontograma e historial', description: 'Estado dental, sesiones y procedimientos.' },
  ],
}

export const postgresTableGroups: Record<string, { label: string; tables: string[] }> = {
  agenda: { label: 'Agenda', tables: ['cita'] },
  care: { label: 'Atención', tables: ['consulta', 'cita_consulta', 'evaluacion_fisica', 'hospitalizacion'] },
  history: { label: 'Historial clínico', tables: ['antecedente', 'alergia_paciente', 'diagnostico', 'tratamiento', 'receta', 'detalle_receta', 'resultado_examen'] },
  catalogs: { label: 'Catálogos', tables: ['medico', 'especialidad', 'medico_especialidad', 'medicamento'] },
  // El teléfono se registra junto con paciente en el formulario principal.
  patients: { label: 'Contactos del paciente', tables: ['telefono_paciente', 'contacto_emergencia'] },
}

export const relationalTableLabels: Record<string, string> = {
  cita: 'Citas',
  contacto_emergencia: 'Contactos de emergencia',
  consulta: 'Consultas',
  cita_consulta: 'Vincular cita y consulta',
  evaluacion_fisica: 'Evaluaciones físicas',
  hospitalizacion: 'Hospitalizaciones',
  antecedente: 'Antecedentes',
  alergia_paciente: 'Alergias',
  diagnostico: 'Diagnósticos',
  tratamiento: 'Tratamientos',
  receta: 'Recetas',
  detalle_receta: 'Detalle de receta',
  resultado_examen: 'Resultados de exámenes',
  medico: 'Médicos',
  especialidad: 'Especialidades',
  medico_especialidad: 'Asignar especialidad a médico',
  medicamento: 'Medicamentos',
  telefono_paciente: 'Teléfonos de pacientes',
}
