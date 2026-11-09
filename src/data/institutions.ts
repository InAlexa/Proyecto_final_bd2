import type { Institution, InstitutionId, Patient } from '../domain'

export const institutions: Institution[] = [
  { id: 'hospital', shortName: 'Hospital', name: 'Hospital General', specialty: 'Atención y seguimiento', accent: '#0588c8', accentSoft: '#e5f5fd', icon: 'H' },
  { id: 'pediatria', shortName: 'Pediatría', name: 'Centro Médico Pediátrico', specialty: 'Crecimiento y vacunas', accent: '#f59a0b', accentSoft: '#fff5df', icon: 'P' },
  { id: 'odontologia', shortName: 'Odontología', name: 'Clínica Odontológica', specialty: 'Agenda y odontograma', accent: '#10b981', accentSoft: '#e7fbf3', icon: 'O' },
  { id: 'laboratorio', shortName: 'Laboratorio', name: 'Laboratorio Clínico', specialty: 'Órdenes y resultados', accent: '#8b5cf6', accentSoft: '#f1ebff', icon: 'L' },
]

export const demoPatients: Record<InstitutionId, Patient[]> = {
  hospital: [
    { id: 'h-1', name: 'Elena Morales Gómez', record: 'HOSP-001', detail: '58 años · Medicina interna', status: 'En consulta', updated: 'Hoy, 09:20', initials: 'EM' },
    { id: 'h-2', name: 'Carlos Mendoza Pineda', record: 'HOSP-002', detail: '42 años · Cirugía general', status: 'Activo', updated: 'Hoy, 08:45', initials: 'CM' },
    { id: 'h-3', name: 'María Fernanda López', record: 'HOSP-003', detail: '34 años · Cardiología', status: 'Pendiente', updated: 'Ayer, 16:10', initials: 'ML' },
  ],
  pediatria: [
    { id: 'p-1', name: 'Mateo Andrés Rivas', record: 'PED-001', detail: '18 meses · Tutor: Sofía Álvarez', status: 'En consulta', updated: 'Hoy, 09:00', initials: 'MR' },
    { id: 'p-2', name: 'Camila Sofía Soto', record: 'PED-002', detail: '3 años · Tutora: Mariana Duarte', status: 'Pendiente', updated: 'Hoy, 08:30', initials: 'CS' },
    { id: 'p-3', name: 'Diego Estuardo López', record: 'PED-003', detail: '7 años · Tutor: Julio López', status: 'Activo', updated: 'Ayer, 15:20', initials: 'DL' },
  ],
  odontologia: [
    { id: 'o-1', name: 'Sofía Ramírez Díaz', record: 'OD-001', detail: '13 años · Evaluación dental', status: 'En consulta', updated: 'Hoy, 10:15', initials: 'SR' },
    { id: 'o-2', name: 'Andrés Castillo', record: 'OD-002', detail: '31 años · Control preventivo', status: 'Pendiente', updated: 'Hoy, 09:30', initials: 'AC' },
    { id: 'o-3', name: 'Valeria Cifuentes', record: 'OD-003', detail: '24 años · Restauración', status: 'Activo', updated: 'Ayer, 14:05', initials: 'VC' },
  ],
  laboratorio: [
    { id: 'l-1', name: 'Marcos Antonio Peña', record: 'LAB-001', detail: '42 años · Hemograma 5 partes', status: 'Pendiente', updated: 'Hoy, 10:42', initials: 'MP' },
    { id: 'l-2', name: 'Andrea López', record: 'LAB-002', detail: '27 años · Perfil lipídico', status: 'En consulta', updated: 'Hoy, 09:55', initials: 'AL' },
    { id: 'l-3', name: 'José Manuel Díaz', record: 'LAB-003', detail: '66 años · Examen de orina', status: 'Activo', updated: 'Ayer, 16:30', initials: 'JD' },
  ],
}

export const institutionById = (id: InstitutionId) => institutions.find((item) => item.id === id)!
