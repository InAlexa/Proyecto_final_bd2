export type InstitutionId = 'hospital' | 'pediatria' | 'odontologia' | 'laboratorio'

export type Institution = {
  id: InstitutionId
  shortName: string
  name: string
  specialty: string
  accent: string
  accentSoft: string
  icon: string
}

export type Patient = {
  id: string
  name: string
  record: string
  detail: string
  status: 'Activo' | 'En consulta' | 'Pendiente' | 'Archivado'
  statusValue?: string
  updated: string
  initials: string
  dpi?: string | null
  birthDate?: string | null
  sex?: string
  address?: string | null
  phone?: string | null
  email?: string | null
  createdAt?: string
  archiveDate?: string | null
  archiveReason?: string | null
}

export type AuthSession = {
  username: string
  displayName: string
  role: 'institution' | 'admin'
  institutionId: InstitutionId | null
}

export interface PatientRepository {
  findPatients(institution: InstitutionId, search?: string): Promise<Patient[]>
  createPatient(institution: InstitutionId, patient: Omit<Patient, 'id' | 'updated'>): Promise<Patient>
}
