import 'dotenv/config'
import { randomBytes } from 'node:crypto'
import express, { type Request, type Response } from 'express'
import { MongoClient, ObjectId, type Document } from 'mongodb'
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore'
import { Pool } from 'pg'
import mysql, { type ExecuteValues, type RowDataPacket } from 'mysql2/promise'
import { postgresTableGroups, relationalTableLabels } from '../src/data/workspaces.ts'
import type { AuthSession, InstitutionId, Patient } from '../src/domain.ts'
import { postgresConfigFromEnv } from './postgres-config.ts'
import { mysqlConfigFromEnv } from './mysql-config.ts'

const app = express()
const port = Number(process.env.PORT || 3001)
const institutionIds: InstitutionId[] = ['hospital', 'pediatria', 'odontologia', 'laboratorio']

app.use(express.json({ limit: '1mb' }))

const accounts: Array<AuthSession & { password: string }> = [
  { username: 'hospital', password: process.env.APP_HOSPITAL_PASSWORD || '', displayName: 'Usuario Hospital', role: 'institution', institutionId: 'hospital' },
  { username: 'pediatria', password: process.env.APP_PEDIATRIA_PASSWORD || '', displayName: 'Usuario Pediatría', role: 'institution', institutionId: 'pediatria' },
  { username: 'odontologia', password: process.env.APP_ODONTOLOGIA_PASSWORD || '', displayName: 'Usuario Odontología', role: 'institution', institutionId: 'odontologia' },
  { username: 'laboratorio', password: process.env.APP_LABORATORIO_PASSWORD || '', displayName: 'Usuario Laboratorio', role: 'institution', institutionId: 'laboratorio' },
  { username: 'admin', password: process.env.APP_ADMIN_PASSWORD || '', displayName: 'Administración', role: 'admin', institutionId: null },
]

type SessionRecord = { session: AuthSession; expiresAt: number }
const sessions = new Map<string, SessionRecord>()
const sessionCookie = 'clinic_session'
const sessionDurationMs = 8 * 60 * 60 * 1000

const postgresConfig = postgresConfigFromEnv()
const postgresPool = postgresConfig ? new Pool(postgresConfig) : null
const mysqlConfig = mysqlConfigFromEnv()
const mysqlPool = mysqlConfig ? mysql.createPool(mysqlConfig) : null

const mongoUri = process.env.MONGODB_URI
const mongoClient = mongoUri ? new MongoClient(mongoUri) : null
let mongoConnection: Promise<MongoClient> | null = null
const firebaseProjectId = process.env.FIREBASE_PROJECT_ID
let firestoreClient: Firestore | null = null

const dentalCollections = new Set(['pacientes', 'citas_odontologicas', 'historiales_odontologicos'])
const dentalCollectionFields: Record<string, Set<string>> = {
  pacientes: new Set(['identificacion', 'nombres', 'apellidos', 'fecha_nacimiento', 'sexo', 'telefono', 'correo', 'direccion', 'contacto_emergencia', 'anamnesis_medica', 'activo', 'fecha_baja', 'motivo_baja']),
  citas_odontologicas: new Set(['paciente_id', 'odontologo_id', 'odontologo_nombre', 'fecha_programada', 'duracion_minutos', 'estado_cita', 'motivo', 'sala_sillon_asignado', 'notas']),
  historiales_odontologicos: new Set(['paciente_id', 'numero_expediente', 'odontograma_general', 'sesiones_clinicas']),
}


function getOdontologiaFirestore(): Firestore {
  if (!firebaseProjectId) throw new Error('FIREBASE_PROJECT_ID is not configured.')
  if (firestoreClient) return firestoreClient
  const app = getApps().find((candidate) => candidate.name === '[DEFAULT]') || initializeApp({
    credential: applicationDefault(),
    projectId: firebaseProjectId,
  })
  firestoreClient = getFirestore(app)
  return firestoreClient
}

function serializeFirestoreValue(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (Array.isArray(value)) return value.map(serializeFirestoreValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, serializeFirestoreValue(entry)]))
  }
  return value
}

function objectValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readCookie(req: Request, name: string): string | null {
  const cookieHeader = req.headers.cookie
  if (!cookieHeader) return null
  const pair = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : null
}

function getSession(req: Request): AuthSession | null {
  const token = readCookie(req, sessionCookie)
  if (!token) return null
  const record = sessions.get(token)
  if (!record) return null
  if (record.expiresAt < Date.now()) {
    sessions.delete(token)
    return null
  }
  return record.session
}

function setSessionCookie(res: Response, token: string, maxAge: number) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  res.setHeader('Set-Cookie', `${sessionCookie}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`)
}

function requireSession(req: Request, res: Response): AuthSession | null {
  const session = getSession(req)
  if (!session) res.status(401).json({ error: 'Inicia sesión para continuar.' })
  return session
}

function isInstitutionId(value: unknown): value is InstitutionId {
  return typeof value === 'string' && institutionIds.includes(value as InstitutionId)
}

function requestedInstitution(value: unknown, session: AuthSession, res: Response): InstitutionId | null {
  if (session.role !== 'admin') return session.institutionId
  if (!isInstitutionId(value)) {
    res.status(400).json({ error: 'Selecciona una institución válida.' })
    return null
  }
  return value
}

function canUseInstitution(session: AuthSession, institution: InstitutionId, res: Response): boolean {
  if (session.role === 'admin' || session.institutionId === institution) return true
  res.status(403).json({ error: 'No tienes acceso a este espacio.' })
  return false
}

function formatDate(value: Date | string | undefined): string {
  if (!value) return 'Sin actividad reciente'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return 'Sin actividad reciente'
  return new Intl.DateTimeFormat('es-GT', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function calculateAge(value: Date | string | undefined): number | null {
  if (!value) return null
  const birthDate = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(birthDate.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - birthDate.getUTCFullYear()
  const beforeBirthday = now.getMonth() < birthDate.getUTCMonth() || (now.getMonth() === birthDate.getUTCMonth() && now.getDate() < birthDate.getUTCDate())
  if (beforeBirthday) age -= 1
  return age >= 0 ? age : null
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() || '').join('') || 'P'
}

function safeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizePatient(patient: unknown): {
  name: string
  names: string
  surnames: string
  dpi: string | null
  birthDate: string
  sex: string
  phone: string | null
  email: string | null
  address: string | null
  status: 'activo' | 'archivado'
  archiveDate: string | null
  archiveReason: string | null
  mongoStatus: 'ACTIVO' | 'INACTIVO' | 'FALLECIDO' | 'TRASLADADO' | null
} | null {
  if (!patient || typeof patient !== 'object') return null
  const input = patient as Record<string, unknown>
  const names = typeof input.names === 'string' ? input.names.trim().replace(/\s+/g, ' ') : ''
  const surnames = typeof input.surnames === 'string' ? input.surnames.trim().replace(/\s+/g, ' ') : ''
  const fullName = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : ''
  const name = fullName || `${names} ${surnames}`.trim()
  const dpiValue = typeof input.dpi === 'string' ? input.dpi.trim() : ''
  const birthDate = typeof input.birthDate === 'string' ? input.birthDate : ''
  const sex = typeof input.sex === 'string' ? input.sex : 'no_informado'
  const phoneValue = typeof input.phone === 'string' ? input.phone.trim() : ''
  const emailValue = typeof input.email === 'string' ? input.email.trim() : ''
  const addressValue = typeof input.address === 'string' ? input.address.trim() : ''
  const rawStatus = typeof input.status === 'string' ? input.status : ''
  const mongoStatus = ['ACTIVO', 'INACTIVO', 'FALLECIDO', 'TRASLADADO'].includes(rawStatus) ? rawStatus as 'ACTIVO' | 'INACTIVO' | 'FALLECIDO' | 'TRASLADADO' : null
  const status = rawStatus === 'archivado' || (mongoStatus !== null && mongoStatus !== 'ACTIVO') ? 'archivado' : rawStatus === 'activo' || mongoStatus === 'ACTIVO' || input.status === undefined ? 'activo' : null
  const archiveDateValue = typeof input.archiveDate === 'string' ? input.archiveDate : ''
  const archiveReasonValue = typeof input.archiveReason === 'string' ? input.archiveReason.trim() : ''
  if ((!fullName && (!names || !surnames)) || names.length > 100 || surnames.length > 100 || !name || name.length > 200 || addressValue.length > 5000) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null
  const parsedDate = new Date(`${birthDate}T00:00:00.000Z`)
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== birthDate) return null
  if (dpiValue && !/^\d{13}$/.test(dpiValue)) return null
  if (!['femenino', 'masculino', 'otro', 'no_informado'].includes(sex)) return null
  if (!status || phoneValue.length > 25 || emailValue.length > 150 || archiveReasonValue.length > 500) return null
  let archiveDate: string | null = null
  let archiveReason: string | null = null
  if (status === 'archivado') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(archiveDateValue) || !archiveReasonValue) return null
    const parsedArchiveDate = new Date(`${archiveDateValue}T00:00:00.000Z`)
    if (Number.isNaN(parsedArchiveDate.getTime()) || parsedArchiveDate.toISOString().slice(0, 10) !== archiveDateValue) return null
    archiveDate = archiveDateValue
    archiveReason = archiveReasonValue
  }
  return { name, names, surnames, dpi: dpiValue || null, birthDate, sex, phone: phoneValue || null, email: emailValue || null, address: addressValue || null, status, archiveDate, archiveReason, mongoStatus }
}

function mapPostgresPatient(row: Record<string, unknown>): Patient {
  const id = String(row.id_paciente)
  const name = `${String(row.nombres || '')} ${String(row.apellidos || '')}`.trim()
  const age = calculateAge(row.fecha_nacimiento as Date | string)
  const createdAt = formatDate(row.fecha_registro as Date | string)
  return {
    id,
    name,
    record: `HOSP-${id.padStart(3, '0')}`,
    detail: age === null ? 'Expediente clínico' : `${age} años · Expediente clínico`,
    status: row.estado === 'archivado' ? 'Archivado' : 'Activo',
    statusValue: String(row.estado || ''),
    updated: createdAt,
    initials: initials(name),
    dpi: row.dpi ? String(row.dpi) : null,
    birthDate: dateOnly(row.fecha_nacimiento),
    sex: String(row.sexo_registrado || ''),
    address: typeof row.direccion === 'string' ? row.direccion : null,
    phone: typeof row.telefono === 'string' ? row.telefono : null,
    createdAt,
    archiveDate: dateOnly(row.fecha_archivo),
    archiveReason: typeof row.motivo_archivo === 'string' ? row.motivo_archivo : null,
  }
}

function mapPediatricPatient(row: Record<string, unknown>): Patient {
  const id = String(row.id_paciente)
  const name = `${String(row.nombres || '')} ${String(row.apellidos || '')}`.trim()
  const age = calculateAge(row.fecha_nacimiento as Date | string)
  const createdAt = formatDate(row.fecha_registro as Date | string)
  const guardian = `${String(row.tutor_nombres || '')} ${String(row.tutor_apellidos || '')}`.trim()
  return {
    id,
    name,
    record: String(row.no_expediente || `PED-${id.padStart(3, '0')}`),
    detail: `${age === null ? 'Edad no disponible' : `${age} años`}${guardian ? ` · Tutor: ${guardian}` : ''}`,
    status: row.estado === 'archivado' ? 'Archivado' : 'Activo',
    statusValue: String(row.estado || ''),
    updated: createdAt,
    initials: initials(name),
    birthDate: dateOnly(row.fecha_nacimiento),
    sex: String(row.sexo || ''),
    createdAt,
    archiveDate: dateOnly(row.fecha_archivo),
    archiveReason: typeof row.motivo_archivo === 'string' ? row.motivo_archivo : null,
  }
}

function dateOnly(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const result = String(value).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null
}

function mapMongoPatient(document: Document): Patient {
  const name = String(document.nombre || 'Paciente')
  const birthDate = document.fechaNacimiento instanceof Date ? document.fechaNacimiento : new Date(String(document.fechaNacimiento || ''))
  const id = document._id instanceof ObjectId ? document._id.toHexString() : String(document._id || '')
  const age = calculateAge(birthDate)
  const createdAt = document._id instanceof ObjectId ? document._id.getTimestamp() : undefined
  return {
    id,
    name,
    record: `LAB-${id.slice(-6).toUpperCase()}`,
    detail: age === null ? 'Registro de laboratorio' : `${age} años · Registro de laboratorio`,
    status: ['INACTIVO', 'FALLECIDO', 'TRASLADADO'].includes(String(document.estado)) ? 'Archivado' : 'Activo',
    statusValue: String(document.estado || ''),
    updated: formatDate(createdAt),
    initials: initials(name),
    dpi: typeof document.dpi === 'string' ? document.dpi : null,
    birthDate: dateOnly(birthDate),
    sex: typeof document.sexoRegistrado === 'string' ? document.sexoRegistrado : undefined,
    address: typeof document.direccion === 'string' ? document.direccion : null,
    phone: typeof document.contacto?.telefono === 'string' ? document.contacto.telefono : null,
    email: typeof document.contacto?.email === 'string' ? document.contacto.email : null,
    createdAt: createdAt ? formatDate(createdAt) : undefined,
    archiveDate: dateOnly(document.fechaBaja),
    archiveReason: typeof document.motivoBaja === 'string' ? document.motivoBaja : null,
  }
}

function mapDentalPatient(id:string,document:Record<string,any>,record?:string):Patient {
  const name=`${document.nombres||''} ${document.apellidos||''}`.trim()||'Paciente';const age=calculateAge(String(document.fecha_nacimiento||''));const archived=document.activo===false
  return {id,name,record:record||String(document.numero_expediente||`OD-${id.slice(-6).toUpperCase()}`),detail:age===null?'Expediente odontológico':`${age} años · Expediente odontológico`,status:archived?'Archivado':'Activo',statusValue:archived?'inactivo':'activo',updated:formatDate(document.fecha_creacion?.toDate?.()||document.fecha_creacion),initials:initials(name),dpi:typeof document.identificacion?.numero==='string'?document.identificacion.numero:null,birthDate:typeof document.fecha_nacimiento==='string'?document.fecha_nacimiento:null,sex:document.sexo,address:document.direccion||null,phone:document.telefono||null,email:document.correo||null,createdAt:formatDate(document.fecha_creacion?.toDate?.()||document.fecha_creacion),archiveDate:document.fecha_baja?.toDate?.()?.toISOString?.().slice(0,10)||null,archiveReason:document.motivo_baja||null}
}

async function connectMongo() {
  if (!mongoClient) throw new Error('MongoDB no está configurado.')
  mongoConnection ??= mongoClient.connect()
  return mongoConnection
}

async function findPostgresPatients(search: string): Promise<Patient[]> {
  if (!postgresPool) throw new Error('PostgreSQL no está configurado.')
  const pattern = `%${search}%`
  const result = await postgresPool.query(
    `SELECT p.id_paciente, p.nombres, p.apellidos, p.dpi, p.fecha_nacimiento, p.sexo_registrado,
            p.direccion, p.estado, p.fecha_registro, p.fecha_archivo, p.motivo_archivo,
            (SELECT t.telefono FROM hospital_general.telefono_paciente t
             WHERE t.id_paciente = p.id_paciente ORDER BY t.id_telefono_paciente LIMIT 1) AS telefono
     FROM hospital_general.paciente p
     WHERE $1 = '%%' OR p.nombres ILIKE $1 OR p.apellidos ILIKE $1 OR COALESCE(p.dpi, '') ILIKE $1
     ORDER BY p.fecha_registro DESC, p.id_paciente DESC
     LIMIT 200`,
    [pattern],
  )
  return result.rows.map((row) => mapPostgresPatient(row as Record<string, unknown>))
}

async function findPediatricPatients(search: string): Promise<Patient[]> {
  if (!mysqlPool) throw new Error('MySQL no está configurado.')
  const pattern = `%${search}%`
  const [rows] = await mysqlPool.execute<RowDataPacket[]>(
    `SELECT p.id_paciente, p.no_expediente, p.nombres, p.apellidos, p.fecha_nacimiento, p.sexo,
            p.fecha_registro, p.estado, p.fecha_archivo, p.motivo_archivo,
            t.nombres AS tutor_nombres, t.apellidos AS tutor_apellidos
     FROM paciente p JOIN tutor t ON t.id_tutor = p.id_tutor
     WHERE ? = '%%' OR p.nombres LIKE ? OR p.apellidos LIKE ? OR p.no_expediente LIKE ?
     ORDER BY p.fecha_registro DESC, p.id_paciente DESC LIMIT 200`,
    [pattern, pattern, pattern, pattern],
  )
  return rows.map((row) => mapPediatricPatient(row))
}

async function findMongoPatients(search: string): Promise<Patient[]> {
  const client = await connectMongo()
  const database = client.db(process.env.MONGODB_DB || 'laboratorio_clinico_db')
  const query: Document = search
    ? { $or: [{ nombre: { $regex: safeRegex(search), $options: 'i' } }, { dpi: { $regex: safeRegex(search) } }] }
    : {}
  const documents = await database.collection('pacientes').find(query).sort({ _id: -1 }).limit(200).toArray()
  return documents.map(mapMongoPatient)
}

async function insertPostgresPatient(patient: NonNullable<ReturnType<typeof normalizePatient>>): Promise<Patient> {
  if (!postgresPool) throw new Error('PostgreSQL no está configurado.')
  const client = await postgresPool.connect()
  try {
    await client.query('BEGIN')
    const inserted = await client.query(
      `INSERT INTO hospital_general.paciente
         (dpi, nombres, apellidos, fecha_nacimiento, sexo_registrado, direccion, estado, fecha_archivo, motivo_archivo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id_paciente, nombres, apellidos, dpi, fecha_nacimiento, sexo_registrado, direccion,
                 estado, fecha_registro, fecha_archivo, motivo_archivo`,
      [patient.dpi, patient.names, patient.surnames, patient.birthDate, patient.sex, patient.address, patient.status, patient.archiveDate, patient.archiveReason],
    )
    const row = inserted.rows[0] as Record<string, unknown>
    if (patient.phone) await client.query('INSERT INTO hospital_general.telefono_paciente(id_paciente,telefono,tipo) VALUES($1,$2,$3)', [row.id_paciente, patient.phone, 'movil'])
    await client.query('COMMIT')
    return mapPostgresPatient(row)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function insertMongoPatient(patient: NonNullable<ReturnType<typeof normalizePatient>>): Promise<Patient> {
  const client = await connectMongo()
  const database = client.db(process.env.MONGODB_DB || 'laboratorio_clinico_db')
  const document = {
    nombre: patient.name,
    dpi: patient.dpi,
    fechaNacimiento: new Date(`${patient.birthDate}T00:00:00.000Z`),
    estado: patient.mongoStatus || (patient.status === 'archivado' ? 'INACTIVO' : 'ACTIVO'),
    contacto: { ...(patient.phone ? { telefono: patient.phone } : {}), ...(patient.email ? { email: patient.email } : {}) },
    sexoRegistrado: patient.sex,
    ...(patient.address ? { direccion: patient.address } : {}),
    ...(patient.archiveDate ? { fechaBaja: new Date(`${patient.archiveDate}T00:00:00.000Z`) } : {}),
    ...(patient.archiveReason ? { motivoBaja: patient.archiveReason } : {}),
  }
  const result = await database.collection('pacientes').insertOne(document)
  return mapMongoPatient({ ...document, _id: result.insertedId })
}

const hospitalEntryTables = new Set(Object.values(postgresTableGroups).flatMap((group) => group.tables))
const allowedHospitalTables = new Set([...hospitalEntryTables, 'paciente'])
const postgresChoices: Record<string, string[]> = {
  'cita.estado': ['programada', 'confirmada', 'atendida', 'cancelada', 'no_asistio'],
  'consulta.tipo': ['externa', 'urgencia', 'seguimiento'],
  'consulta.estado': ['borrador', 'cerrada'],
  'antecedente.tipo': ['personal', 'familiar', 'quirurgico', 'habito', 'otro'],
  'alergia_paciente.gravedad': ['leve', 'moderada', 'grave', 'desconocida'],
  'diagnostico.tipo': ['presuntivo', 'definitivo'],
  'tratamiento.estado': ['indicado', 'en_curso', 'completado', 'suspendido'],
  'telefono_paciente.tipo': ['personal', 'movil', 'emergencia', 'trabajo'],
}

const pediatricEntryTables = new Set([
  'tutor', 'telefono_tutor', 'correo_tutor', 'paciente', 'antecedente_paciente', 'alergia_paciente',
  'cita', 'consulta', 'cita_consulta', 'control_crecimiento', 'vacuna', 'registro_vacunacion',
  'diagnostico', 'receta', 'detalle_receta', 'especialidad', 'pediatra', 'pediatra_especialidad',
  'telefono_pediatra', 'correo_pediatra', 'personal_enfermeria', 'medicamento', 'institucion',
  'paciente_institucion', 'documento_externo', 'bitacora_intercambio', 'bitacora_auditoria',
])

function quoteMysqlIdentifier(identifier: string) {
  return `\`${identifier.replaceAll('`', '``')}\``
}

async function pediatricTableColumns(table: string): Promise<Array<{
  column_name: string; data_type: string; is_nullable: string; column_default: string | null
  extra: string; generation_expression: string
}>> {
  if (!mysqlPool || !pediatricEntryTables.has(table)) throw new Error('Tabla pediátrica no disponible.')
  const [rows] = await mysqlPool.execute<RowDataPacket[]>(
    `SELECT COLUMN_NAME AS column_name, DATA_TYPE AS data_type, IS_NULLABLE AS is_nullable,
            COLUMN_DEFAULT AS column_default, EXTRA AS extra, GENERATION_EXPRESSION AS generation_expression
     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [table],
  )
  return rows as Array<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null; extra: string; generation_expression: string }>
}

function quotePgIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`
}

function publicInsertError(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code || '') : ''
  if (code === '23505') return 'Ya existe un registro con uno de esos datos únicos.'
  if (code === '23503') return 'Selecciona primero un registro relacionado que exista.'
  if (code === '23514' || code === '23502') return 'Revisa los valores requeridos y las opciones permitidas.'
  if (code === '42501') return 'La cuenta de base de datos no tiene permiso para guardar este registro.'
  return 'No se pudo guardar. Revisa los campos relacionados e inténtalo de nuevo.'
}

async function hospitalTableColumns(table: string) {
  if (!postgresPool || !allowedHospitalTables.has(table)) throw new Error('Tabla no disponible.')
  const result = await postgresPool.query(
    `SELECT c.column_name, c.data_type, c.is_nullable, c.column_default, c.is_identity, c.is_generated,
            fk.foreign_table, fk.foreign_column
     FROM information_schema.columns c
     LEFT JOIN (
       SELECT source_table.relname AS table_name, source_column.attname AS column_name,
              target_table.relname AS foreign_table, target_column.attname AS foreign_column
       FROM pg_constraint fk
       JOIN pg_class source_table ON source_table.oid = fk.conrelid
       JOIN pg_namespace source_schema ON source_schema.oid = source_table.relnamespace
       JOIN pg_class target_table ON target_table.oid = fk.confrelid
       JOIN LATERAL unnest(fk.conkey) WITH ORDINALITY source_key(attnum, key_order) ON TRUE
       JOIN LATERAL unnest(fk.confkey) WITH ORDINALITY target_key(attnum, key_order) ON target_key.key_order = source_key.key_order
       JOIN pg_attribute source_column ON source_column.attrelid = source_table.oid AND source_column.attnum = source_key.attnum
       JOIN pg_attribute target_column ON target_column.attrelid = target_table.oid AND target_column.attnum = target_key.attnum
       WHERE fk.contype = 'f' AND source_schema.nspname = 'hospital_general'
     ) fk ON fk.table_name = c.table_name AND fk.column_name = c.column_name
     WHERE c.table_schema = 'hospital_general' AND c.table_name = $1
     ORDER BY c.ordinal_position`,
    [table],
  )
  return result.rows as Array<{
    column_name: string; data_type: string; is_nullable: string; column_default: string | null
    is_identity: string; is_generated: string; foreign_table: string | null; foreign_column: string | null
  }>
}

async function hospitalReferenceOptions(table: string, column: string) {
  if (!postgresPool || !allowedHospitalTables.has(table)) return []
  const columns = await hospitalTableColumns(table)
  if (!columns.some((entry) => entry.column_name === column)) return []
  const labelNames = ['no_expediente', 'nombres', 'apellidos', 'nombre', 'descripcion', 'dpi', 'colegiado', 'motivo']
  const labelColumns = labelNames.filter((name) => columns.some((entry) => entry.column_name === name))
  const labelExpression = labelColumns.length
    ? `concat_ws(' · ', ${labelColumns.map((name) => `NULLIF(${quotePgIdentifier(name)}::text, '')`).join(', ')})`
    : `${quotePgIdentifier(column)}::text`
  const result = await postgresPool.query(
    `SELECT ${quotePgIdentifier(column)}::text AS value, ${labelExpression} AS label
     FROM hospital_general.${quotePgIdentifier(table)}
     ORDER BY ${quotePgIdentifier(column)} DESC LIMIT 200`,
  )
  return result.rows.map((row) => ({ value: String(row.value), label: String(row.label || row.value) }))
}

app.get('/api/hospital/schema', async (req, res) => {
  const session = requireSession(req, res)
  if (!session) return
  if (!canUseInstitution(session, 'hospital', res)) return
  if (!postgresPool) {
    res.status(503).json({ error: 'Los formularios de esta sección no están disponibles.' })
    return
  }
  const groupId = typeof req.query.group === 'string' ? req.query.group : ''
  const group = postgresTableGroups[groupId]
  if (!group) {
    res.status(404).json({ error: 'No existe esta sección.' })
    return
  }
  try {
    const tables = await Promise.all(group.tables.map(async (table) => {
      const columns = await hospitalTableColumns(table)
      const mappedColumns = await Promise.all(columns.map(async (column) => {
        const choices = postgresChoices[`${table}.${column.column_name}`] || []
        const isReference = Boolean(column.foreign_table && column.foreign_column)
        return {
          name: column.column_name,
          label: column.column_name.replaceAll('_', ' ').replace(/\b(id)\b/gi, 'ID').replace(/\b\w/g, (letter) => letter.toUpperCase()),
          dataType: column.data_type,
          nullable: column.is_nullable === 'YES',
          defaulted: Boolean(column.column_default),
          required: column.is_nullable === 'NO' && !column.column_default && column.is_identity !== 'YES' && column.is_generated === 'NEVER',
          identity: column.is_identity === 'YES' || /nextval\(/i.test(column.column_default || ''),
          generated: column.is_generated !== 'NEVER',
          choices,
          isForeignKey: isReference,
          referenceOptions: isReference ? await hospitalReferenceOptions(column.foreign_table!, column.foreign_column!) : [],
        }
      }))
      return { name: table, label: relationalTableLabels[table] || table, columns: mappedColumns }
    }))
    res.json({ group: { id: groupId, label: group.label, tables } })
  } catch {
    res.status(503).json({ error: 'No se pudo preparar esta sección. Revisa la configuración e inténtalo de nuevo.' })
  }
})

app.get('/api/hospital/records', async (req, res) => {
  const session = requireSession(req, res)
  if (!session) return
  if (!canUseInstitution(session, 'hospital', res)) return
  const table = typeof req.query.table === 'string' ? req.query.table : ''
  if (!postgresPool || !hospitalEntryTables.has(table)) {
    res.status(404).json({ error: 'No existe esta tabla.' })
    return
  }
  try {
    const columns = await hospitalTableColumns(table)
    const primary = await postgresPool.query(
      `SELECT kcu.column_name FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_schema = kcu.constraint_schema AND tc.constraint_name = kcu.constraint_name
       WHERE tc.constraint_schema = 'hospital_general' AND tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY'
       ORDER BY kcu.ordinal_position LIMIT 1`,
      [table],
    )
    const sortColumn = primary.rows[0]?.column_name || columns[0]?.column_name
    const records = await postgresPool.query(
      `SELECT * FROM hospital_general.${quotePgIdentifier(table)} ORDER BY ${quotePgIdentifier(sortColumn)} DESC LIMIT 25`,
    )
    res.json({ columns: columns.map((column) => column.column_name), records: records.rows })
  } catch {
    res.status(503).json({ error: 'No se pudieron cargar los registros.' })
  }
})

app.post('/api/hospital/records', async (req, res) => {
  const session = requireSession(req, res)
  if (!session) return
  if (!canUseInstitution(session, 'hospital', res)) return
  const body = req.body as { table?: unknown; values?: unknown }
  const table = typeof body.table === 'string' ? body.table : ''
  if (!postgresPool || !hospitalEntryTables.has(table) || !body.values || typeof body.values !== 'object' || Array.isArray(body.values)) {
    res.status(400).json({ error: 'No se pudo identificar el registro que quieres guardar.' })
    return
  }
  try {
    const columns = await hospitalTableColumns(table)
    const writableColumns = columns.filter((column) => column.is_identity !== 'YES' && column.is_generated === 'NEVER' && !/nextval\(/i.test(column.column_default || ''))
    const submitted = body.values as Record<string, unknown>
    const allowedNames = new Set(writableColumns.map((column) => column.column_name))
    if (Object.keys(submitted).some((name) => !allowedNames.has(name))) {
      res.status(400).json({ error: 'El formulario contiene campos que no pertenecen a este registro.' })
      return
    }
    const missing = writableColumns.find((column) => column.is_nullable === 'NO' && !column.column_default && !submitted[column.column_name] && submitted[column.column_name] !== false)
    if (missing) {
      res.status(400).json({ error: `Completa el campo ${missing.column_name.replaceAll('_', ' ')}.` })
      return
    }
    for (const column of columns.filter((entry) => entry.foreign_table === 'paciente' && submitted[entry.column_name] !== undefined)) {
      const active = await postgresPool.query("SELECT 1 FROM hospital_general.paciente WHERE id_paciente=$1 AND estado='activo'", [submitted[column.column_name]])
      if (!active.rowCount) { res.status(400).json({ error: 'El paciente no existe o su expediente está archivado.' }); return }
    }
    const entries = Object.entries(submitted).filter(([, value]) => value !== '' && value !== undefined)
    const quotedTable = `hospital_general.${quotePgIdentifier(table)}`
    if (entries.length === 0) {
      await postgresPool.query(`INSERT INTO ${quotedTable} DEFAULT VALUES`)
    } else {
      const names = entries.map(([name]) => quotePgIdentifier(name)).join(', ')
      const placeholders = entries.map((_, index) => `$${index + 1}`).join(', ')
      await postgresPool.query(`INSERT INTO ${quotedTable} (${names}) VALUES (${placeholders})`, entries.map(([, value]) => value))
    }
    res.status(201).json({ saved: true })
  } catch (error) {
    res.status(400).json({ error: publicInsertError(error) })
  }
})

app.get('/api/hospital/options', async (req, res) => {
  const session = requireSession(req, res)
  if (!session) return
  if (!canUseInstitution(session, 'hospital', res)) return
  if (!postgresPool) { res.status(503).json({ error: 'PostgreSQL no está configurado.' }); return }
  try {
    const [patients, doctors, medicines] = await Promise.all([
      postgresPool.query("SELECT id_paciente AS id, concat(nombres, ' ', apellidos) AS label FROM hospital_general.paciente WHERE estado='activo' ORDER BY apellidos LIMIT 300"),
      postgresPool.query(`SELECT id_medico AS id, concat(nombres, ' ', apellidos) AS label FROM hospital_general.medico WHERE activo ORDER BY apellidos LIMIT 200`),
      postgresPool.query(`SELECT id_medicamento AS id, concat(nombre, ' · ', presentacion, ' · ', concentracion) AS label FROM hospital_general.medicamento ORDER BY nombre LIMIT 300`),
    ])
    res.json({ patients: patients.rows, doctors: doctors.rows, medicines: medicines.rows })
  } catch (error) { console.error(error); res.status(503).json({ error: 'No se pudieron cargar los catálogos.' }) }
})

app.get('/api/pediatria/options', async (req, res) => {
  const session = requireSession(req, res)
  if (!session) return
  if (!canUseInstitution(session, 'pediatria', res)) return
  if (!mysqlPool) { res.status(503).json({ error: 'MySQL no está configurado.' }); return }
  try {
    const [patients] = await mysqlPool.query<RowDataPacket[]>("SELECT id_paciente AS id, CONCAT(nombres, ' ', apellidos) AS label FROM paciente WHERE estado='activo' ORDER BY apellidos LIMIT 300")
    const [doctors] = await mysqlPool.query<RowDataPacket[]>("SELECT id_pediatra AS id, CONCAT(nombres, ' ', apellidos) AS label FROM pediatra ORDER BY apellidos LIMIT 200")
    const [nurses] = await mysqlPool.query<RowDataPacket[]>("SELECT id_enfermero AS id, CONCAT(nombres, ' ', apellidos) AS label FROM personal_enfermeria ORDER BY apellidos LIMIT 200")
    const [medicines] = await mysqlPool.query<RowDataPacket[]>("SELECT id_medicamento AS id, CONCAT(nombre_comercial, ' · ', concentracion_pediatrica) AS label FROM medicamento ORDER BY nombre_comercial LIMIT 300")
    const [appointments] = await mysqlPool.query<RowDataPacket[]>("SELECT id_cita AS id, CONCAT(fecha, ' ', hora, ' · ', motivo) AS label FROM cita WHERE estado IN ('programada','confirmada') ORDER BY fecha,hora LIMIT 200")
    res.json({ patients, doctors, nurses, medicines, appointments })
  } catch (error) { console.error(error); res.status(503).json({ error: 'No se pudieron cargar los catálogos pediátricos.' }) }
})

app.get('/api/pediatria/lookup', async (req, res) => {
  const session = requireSession(req, res)
  if (!session) return
  if (!canUseInstitution(session, 'pediatria', res)) return
  if (!mysqlPool) { res.status(503).json({ error: 'MySQL no está configurado.' }); return }
  const table = typeof req.query.table === 'string' ? req.query.table : ''
  const lookups: Record<string, { label: string; sql: string }> = {
    tutor: { label: 'tutor', sql: `SELECT id_tutor AS id, CONCAT(nombres, ' ', apellidos, ' · DPI ', cui_dpi) AS label FROM tutor ORDER BY apellidos LIMIT 300` },
    paciente: { label: 'paciente', sql: `SELECT id_paciente AS id, CONCAT(nombres, ' ', apellidos, ' · ', no_expediente) AS label FROM paciente ORDER BY apellidos LIMIT 300` },
    pediatra: { label: 'pediatra', sql: `SELECT id_pediatra AS id, CONCAT(nombres, ' ', apellidos) AS label FROM pediatra ORDER BY apellidos LIMIT 200` },
    personal_enfermeria: { label: 'enfermería', sql: `SELECT id_enfermero AS id, CONCAT(nombres, ' ', apellidos) AS label FROM personal_enfermeria ORDER BY apellidos LIMIT 200` },
    cita: { label: 'cita', sql: `SELECT id_cita AS id, CONCAT(fecha, ' ', hora, ' · ', motivo) AS label FROM cita ORDER BY fecha DESC, hora DESC LIMIT 300` },
    consulta: { label: 'consulta', sql: `SELECT id_consulta AS id, CONCAT(fecha_hora, ' · ', motivo_consulta) AS label FROM consulta ORDER BY fecha_hora DESC LIMIT 300` },
    vacuna: { label: 'vacuna', sql: `SELECT id_vacuna AS id, nombre AS label FROM vacuna ORDER BY nombre` },
    especialidad: { label: 'especialidad', sql: `SELECT id_especialidad AS id, nombre AS label FROM especialidad ORDER BY nombre` },
    institucion: { label: 'institución', sql: `SELECT id_institucion AS id, nombre AS label FROM institucion ORDER BY nombre` },
    medicamento: { label: 'medicamento', sql: `SELECT id_medicamento AS id, CONCAT(nombre_comercial, ' · ', concentracion_pediatrica) AS label FROM medicamento ORDER BY nombre_comercial LIMIT 300` },
    receta: { label: 'receta', sql: `SELECT id_receta AS id, CONCAT('Receta ', id_receta, ' · consulta ', id_consulta) AS label FROM receta ORDER BY fecha_emision DESC LIMIT 300` },
  }
  const lookup = lookups[table]
  if (!lookup) { res.status(404).json({ error: 'No existe esa referencia.' }); return }
  try {
    const [rows] = await mysqlPool.query<RowDataPacket[]>(lookup.sql)
    res.json({ options: rows.map(row => ({ id: String(row.id), label: String(row.label || row.id) })) })
  } catch (error) { console.error(`No se pudo consultar ${lookup.label}:`, error); res.status(503).json({ error: `No se pudieron cargar las opciones de ${lookup.label}.` }) }
})

app.post('/api/clinical/encounter', async (req, res) => {
  const session = requireSession(req, res)
  if (!session) return
  const institution = requestedInstitution(req.body?.institutionId, session, res)
  if (!institution || !canUseInstitution(session, institution, res)) return
  const b = req.body || {}
  if (!['hospital', 'pediatria'].includes(institution) || !Number(b.patientId) || !Number(b.doctorId) || !String(b.motivo || '').trim() || !String(b.examenFisico || '').trim() || !String(b.diagnostico || '').trim()) {
    res.status(400).json({ error: 'Paciente, profesional, motivo, examen y diagnóstico son requeridos.' }); return
  }
  try {
    if (institution === 'hospital' && postgresPool) {
      const client = await postgresPool.connect()
      try {
        await client.query('BEGIN')
        const activePatient = await client.query("SELECT 1 FROM hospital_general.paciente WHERE id_paciente=$1 AND estado='activo' FOR UPDATE", [Number(b.patientId)])
        if (!activePatient.rowCount) throw new Error('El paciente no existe o su expediente está archivado.')
        const inserted = await client.query(`INSERT INTO hospital_general.consulta(id_paciente,id_medico,tipo,motivo,enfermedad_actual,examen_fisico,evolucion) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id_consulta`, [Number(b.patientId), Number(b.doctorId), b.tipo || 'externa', b.motivo, b.enfermedadActual || b.motivo, b.examenFisico, b.evolucion || null])
        const id = inserted.rows[0].id_consulta
        await client.query('INSERT INTO hospital_general.diagnostico(id_consulta,descripcion,tipo) VALUES($1,$2,$3)', [id, b.diagnostico, b.clasificacion || 'definitivo'])
        if (b.tratamiento) await client.query('INSERT INTO hospital_general.tratamiento(id_consulta,descripcion,fecha_inicio,estado) VALUES($1,$2,CURRENT_DATE,$3)', [id, b.tratamiento, b.estadoTratamiento || 'indicado'])
        if (b.medicamentoId && b.dosis && b.frecuencia && Number(b.duracion) > 0) {
          const rx = await client.query('INSERT INTO hospital_general.receta(id_consulta) VALUES($1) RETURNING id_receta', [id])
          await client.query('INSERT INTO hospital_general.detalle_receta(id_receta,id_medicamento,dosis,via,frecuencia,duracion_dias,indicaciones) VALUES($1,$2,$3,$4,$5,$6,$7)', [rx.rows[0].id_receta, Number(b.medicamentoId), b.dosis, b.via || 'oral', b.frecuencia, Number(b.duracion), b.indicaciones || null])
        }
        await client.query("UPDATE hospital_general.consulta SET estado='cerrada' WHERE id_consulta=$1", [id])
        await client.query('COMMIT'); res.status(201).json({ saved: true, id }); return
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    }
    if (institution === 'pediatria' && mysqlPool) {
      const connection = await mysqlPool.getConnection()
      try {
        await connection.beginTransaction()
        let patientId = Number(b.patientId); let doctorId = Number(b.doctorId); let reason = String(b.motivo); let type = 'urgencia'
        if (b.appointmentId) {
          const [appointments] = await connection.execute<RowDataPacket[]>("SELECT id_paciente,id_pediatra,motivo,tipo_cita FROM cita WHERE id_cita=? AND estado IN ('programada','confirmada') FOR UPDATE", [Number(b.appointmentId)])
          if (!appointments.length) throw new Error('La cita no existe o ya fue atendida.')
          patientId = Number(appointments[0].id_paciente); doctorId = Number(appointments[0].id_pediatra); reason = String(appointments[0].motivo); type = appointments[0].tipo_cita === 'seguimiento' ? 'seguimiento' : 'externa'
          if (patientId !== Number(b.patientId) || doctorId !== Number(b.doctorId)) throw new Error('La cita y los datos seleccionados no coinciden.')
        }
        const [created] = await connection.execute<any>('INSERT INTO consulta(id_paciente,id_pediatra,tipo,motivo_consulta,examen_fisico) VALUES(?,?,?,?,?)', [patientId, doctorId, type, reason, b.examenFisico])
        const id = Number(created.insertId)
        if (b.appointmentId) await connection.execute('INSERT INTO cita_consulta(id_cita,id_consulta) VALUES(?,?)', [Number(b.appointmentId), id])
        await connection.execute('INSERT INTO diagnostico(id_consulta,codigo_cie,nombre,clasificacion,descripcion) VALUES(?,?,?,?,?)', [id, b.codigoCie || 'Z00.0', b.nombreDiagnostico || b.diagnostico, b.clasificacion || 'definitivo', b.diagnostico])
        if (b.weight && b.height && b.nurseId) await connection.execute('CALL sp_registrar_somatometria(?,?,?,?,NULL,NULL,NULL,NULL)', [id, Number(b.nurseId), Number(b.weight), Number(b.height)])
        if (b.medicineId && b.dosis && b.frecuencia && Number(b.duracion) > 0) {
          const [rx] = await connection.execute<any>('INSERT INTO receta(id_consulta,indicaciones_generales) VALUES(?,?)', [id, b.indicaciones || null])
          await connection.execute('INSERT INTO detalle_receta(id_receta,id_medicamento,dosis,via_administracion,frecuencia,duracion_dias,peso_base_calculo_kg,indicaciones) VALUES(?,?,?,?,?,?,?,?)', [rx.insertId, Number(b.medicineId), b.dosis, b.via || 'oral', b.frecuencia, Number(b.duracion), Number(b.weight || 1), b.indicaciones || null])
        }
        await connection.execute("UPDATE consulta SET estado='cerrada' WHERE id_consulta=?", [id])
        await connection.commit(); res.status(201).json({ saved: true, id }); return
      } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
    }
    res.status(503).json({ error: 'Motor no configurado.' })
  } catch (error) { console.error('No se pudo guardar la consulta clínica:', error); res.status(400).json({ error: error instanceof Error ? error.message : 'No se pudo guardar el encuentro. Comprueba catálogos y reglas clínicas.' }) }
})

app.get('/api/pediatria/records', async (req, res) => {
  const session = requireSession(req, res)
  if (!session) return
  if (!canUseInstitution(session, 'pediatria', res)) return
  const table = typeof req.query.table === 'string' ? req.query.table : ''
  if (!mysqlPool || !pediatricEntryTables.has(table)) {
    res.status(404).json({ error: 'No existe esta tabla o MySQL no está configurado.' })
    return
  }
  try {
    const columns = await pediatricTableColumns(table)
    const [keys] = await mysqlPool.execute<RowDataPacket[]>(
      `SELECT COLUMN_NAME AS column_name FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'
       ORDER BY ORDINAL_POSITION LIMIT 1`,
      [table],
    )
    const primaryKey = String(keys[0]?.column_name || columns[0]?.column_name || '')
    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      `SELECT * FROM ${quoteMysqlIdentifier(table)} ORDER BY ${quoteMysqlIdentifier(primaryKey)} DESC LIMIT 50`,
    )
    res.json({ records: rows.map((row) => ({ id: String(row[primaryKey]), data: row })) })
  } catch (error) {
    console.error('No se pudieron consultar registros pediátricos:', error)
    res.status(503).json({ error: 'No se pudieron cargar los registros. Revisa que las tablas de Centro Pediátrico estén instaladas.' })
  }
})

app.post('/api/pediatria/records', async (req, res) => {
  const session = requireSession(req, res)
  if (!session) return
  if (!canUseInstitution(session, 'pediatria', res)) return
  const body = req.body as { table?: unknown; values?: unknown }
  const table = typeof body.table === 'string' ? body.table : ''
  if (!mysqlPool || !pediatricEntryTables.has(table) || !objectValue(body.values)) {
    res.status(400).json({ error: 'Revisa la tabla y los campos del registro.' })
    return
  }
  try {
    const columns = await pediatricTableColumns(table)
    const writable = columns.filter((column) => !column.extra.includes('auto_increment') && !column.generation_expression)
    const allowed = new Set(writable.map((column) => column.column_name))
    const values = body.values
    if (Object.keys(values).some((name) => !allowed.has(name))) {
      res.status(400).json({ error: 'El formulario contiene campos que no corresponden a esta tabla.' })
      return
    }
    const missing = writable.find((column) => column.is_nullable === 'NO' && column.column_default === null && !(column.column_name in values))
    if (missing) {
      res.status(400).json({ error: `Completa el campo ${missing.column_name.replaceAll('_', ' ')}.` })
      return
    }
    const entries: Array<[string, ExecuteValues]> = Object.entries(values).filter(([, value]) => value !== '' && value !== undefined)
      .map(([name, raw]) => {
        const column = writable.find((candidate) => candidate.column_name === name)!
        let value = raw as ExecuteValues
        if (column.data_type === 'datetime' && typeof value === 'string') value = value.replace('T', ' ')
        if (column.data_type === 'json' && typeof value !== 'string') value = JSON.stringify(value)
        return [name, value] as const
      })
    if (entries.length === 0) {
      const [result] = await mysqlPool.query(`INSERT INTO ${quoteMysqlIdentifier(table)} () VALUES ()`)
      res.status(201).json({ saved: true, id: String((result as { insertId?: number }).insertId || '') })
      return
    }
    const names = entries.map(([name]) => quoteMysqlIdentifier(name)).join(', ')
    const placeholders = entries.map(() => '?').join(', ')
    const [result] = await mysqlPool.execute(
      `INSERT INTO ${quoteMysqlIdentifier(table)} (${names}) VALUES (${placeholders})`,
      entries.map(([, value]) => value),
    )
    res.status(201).json({ saved: true, id: String((result as { insertId?: number }).insertId || '') })
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code || '') : ''
    if (code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'Ya existe un registro con uno de esos datos únicos.' })
      return
    }
    if (code === 'ER_NO_REFERENCED_ROW_2') {
      res.status(400).json({ error: 'Selecciona primero un registro relacionado que exista.' })
      return
    }
    if (code === 'ER_CHECK_CONSTRAINT_VIOLATED' || code === 'ER_BAD_NULL_ERROR' || code === 'ER_DATA_TOO_LONG') {
      res.status(400).json({ error: 'Revisa los valores requeridos y las opciones permitidas.' })
      return
    }
    console.error('No se pudo registrar información pediátrica:', error)
    res.status(503).json({ error: 'No se pudo guardar el registro. Revisa las relaciones y los datos requeridos.' })
  }
})

app.post('/api/auth/login', (req, res) => {
  const body = req.body as { username?: unknown; password?: unknown }
  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const account = accounts.find((candidate) => candidate.username === username && candidate.password === password)
  if (!account) {
    res.status(401).json({ error: 'Usuario o contraseña incorrectos.' })
    return
  }
  const session: AuthSession = {
    username: account.username,
    displayName: account.displayName,
    role: account.role,
    institutionId: account.institutionId,
  }
  const token = randomBytes(32).toString('hex')
  sessions.set(token, { session, expiresAt: Date.now() + sessionDurationMs })
  setSessionCookie(res, token, sessionDurationMs / 1000)
  res.json(session)
})

app.get('/api/auth/me', (req, res) => {
  const session = getSession(req)
  if (!session) {
    res.status(401).json({ error: 'Inicia sesión para continuar.' })
    return
  }
  res.json(session)
})

app.post('/api/auth/logout', (req, res) => {
  const token = readCookie(req, sessionCookie)
  if (token) sessions.delete(token)
  setSessionCookie(res, '', 0)
  res.status(204).end()
})

app.get('/api/patients', async (req, res) => {
  const session = requireSession(req, res)
  if (!session) return
  const institution = requestedInstitution(req.query.institution, session, res)
  if (!institution || !canUseInstitution(session, institution, res)) return
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : ''
  try {
    if (institution === 'odontologia') {
      const db=getOdontologiaFirestore(); let query:FirebaseFirestore.Query=db.collection('pacientes')
      if(search) { const snapshot=await query.limit(300).get(); const needle=search.toLocaleLowerCase('es-GT'); const matches=snapshot.docs.filter(d=>`${d.data().nombres||''} ${d.data().apellidos||''} ${d.data().identificacion?.numero||''} ${d.id}`.toLocaleLowerCase('es-GT').includes(needle)).slice(0,200); res.json({patients:matches.map(d=>mapDentalPatient(d.id,d.data()))});return }
      const snapshot=await query.limit(200).get();res.json({patients:snapshot.docs.map(d=>mapDentalPatient(d.id,d.data()))});return
    }
    if (institution === 'hospital' && postgresPool) {
      res.json({ patients: await findPostgresPatients(search) })
      return
    }
    if (institution === 'pediatria' && mysqlPool) {
      res.json({ patients: await findPediatricPatients(search) })
      return
    }
    if (institution === 'laboratorio' && mongoClient) {
      res.json({ patients: await findMongoPatients(search) })
      return
    }
    res.status(503).json({ error: 'El motor de datos de esta institución no está configurado; no se mostrarán registros de muestra.' })
  } catch (error) {
    console.error('No se pudieron consultar los expedientes:', error)
    res.status(503).json({ error: 'No se pudo consultar la información. Revisa la configuración e inténtalo de nuevo.' })
  }
})

app.post('/api/patients', async (req, res) => {
  const session = requireSession(req, res)
  if (!session) return
  const body = req.body as { institutionId?: unknown; patient?: unknown }
  const institution = requestedInstitution(body.institutionId, session, res)
  if (!institution || !canUseInstitution(session, institution, res)) return
  const patient = normalizePatient(body.patient)
  if (!patient || (institution === 'laboratorio' && !patient.dpi)) {
    res.status(400).json({ error: 'Revisa nombres y apellidos, DPI, fecha de nacimiento y los datos de archivo.' })
    return
  }
  try {
    if(institution==='odontologia'){
      const db=getOdontologiaFirestore();const idNumber=patient.dpi
      if(!idNumber){res.status(400).json({error:'El expediente odontológico requiere DPI o número de identificación.'});return}
      const existing=await db.collection('pacientes').where('identificacion.numero','==',idNumber).limit(1).get();if(!existing.empty){res.status(409).json({error:'Ya existe un paciente con esa identificación.'});return}
      const newRef=db.collection('pacientes').doc();const historyRef=db.collection('historiales_odontologicos').doc();const now=new Date()
      const name=patient.name.split(/\s+/);const half=Math.ceil(name.length/2);const data={identificacion:{tipo:'DPI',numero:idNumber},nombres:patient.names||name.slice(0,half).join(' '),apellidos:patient.surnames||name.slice(half).join(' ')||'Sin apellido',fecha_nacimiento:patient.birthDate,sexo:patient.sex,telefono:patient.phone||'',correo:patient.email||'',direccion:patient.address||'',contacto_emergencia:{},anamnesis_medica:{},activo:patient.status==='archivado'?false:true,fecha_creacion:now,...(patient.archiveDate?{fecha_baja:new Date(patient.archiveDate)}:{}),...(patient.archiveReason?{motivo_baja:patient.archiveReason}:{})}
      const record=`OD-${now.getFullYear()}-${newRef.id.slice(-6).toUpperCase()}`
      const batch=db.batch();batch.create(newRef,data);batch.create(historyRef,{paciente_id:newRef.id,numero_expediente:record,odontograma_general:{},sesiones_clinicas:[],ultima_actualizacion:now});await batch.commit()
      res.status(201).json({patient:mapDentalPatient(newRef.id,data,record)});return
    }
    if (institution === 'hospital' && postgresPool) {
      res.status(201).json({ patient: await insertPostgresPatient(patient) })
      return
    }
    if (institution === 'laboratorio' && mongoClient) {
      res.status(201).json({ patient: await insertMongoPatient(patient) })
      return
    }
    res.status(503).json({ error: 'El motor de datos de esta institución no está configurado; no se guardaron los datos.' })
  } catch (error) {
    console.error('No se pudo registrar el expediente:', error)
    res.status(503).json({ error: 'No se pudo guardar el expediente. Revisa los datos e inténtalo de nuevo.' })
  }
})

app.post('/api/patients/:id/archive',async(req,res)=>{const session=requireSession(req,res);if(!session)return;const institution=requestedInstitution(req.body?.institutionId,session,res);if(!institution||!canUseInstitution(session,institution,res))return;const reason=typeof req.body?.reason==='string'?req.body.reason.trim():'';if(!reason){res.status(400).json({error:'Indica el motivo de archivo.'});return}try{const now=new Date();if(institution==='hospital'&&postgresPool){const r=await postgresPool.query("UPDATE hospital_general.paciente SET estado='archivado',fecha_archivo=$2,motivo_archivo=$3 WHERE id_paciente=$1 AND estado='activo' RETURNING id_paciente",[Number(req.params.id),now,reason]);if(!r.rowCount){res.status(404).json({error:'Paciente inexistente o ya archivado.'});return}}else if(institution==='pediatria'&&mysqlPool){const [r]=await mysqlPool.execute<RowDataPacket[]>('CALL sp_archivar_expediente(?,?)',[Number(req.params.id),reason]);void r}else if(institution==='laboratorio'&&mongoClient){if(!ObjectId.isValid(req.params.id)){res.status(400).json({error:'ID inválido.'});return}const c=await connectMongo();const db=c.db(process.env.MONGODB_DB||'laboratorio_clinico_db');const state=['FALLECIDO','TRASLADADO'].includes(String(req.body?.status))?String(req.body.status):'INACTIVO';const r=await db.collection('pacientes').updateOne({_id:new ObjectId(req.params.id),estado:'ACTIVO'},{$set:{estado:state,motivoBaja:reason,fechaBaja:now}});if(!r.matchedCount){res.status(404).json({error:'Paciente inexistente o ya archivado.'});return}}else if(institution==='odontologia'){const d=getOdontologiaFirestore();const ref=d.collection('pacientes').doc(req.params.id);const snap=await ref.get();if(!snap.exists){res.status(404).json({error:'Paciente inexistente.'});return}await ref.update({activo:false,fecha_baja:now,motivo_baja:reason})}else{res.status(503).json({error:'Motor sin conexión.'});return}res.json({archived:true})}catch(e){console.error('No se pudo archivar el expediente:',e);res.status(400).json({error:'No se pudo archivar el expediente. Verifica que siga activo y vuelve a intentarlo.'})}})

app.get('/api/lab/exams', async (req, res) => {
  const session = requireSession(req, res)
  if (!session) return
  if (!canUseInstitution(session, 'laboratorio', res)) return
  if (!mongoClient) {
    res.status(503).json({ error: 'No se pudieron cargar los exámenes.' })
    return
  }
  try {
    const client = await connectMongo()
    const database = client.db(process.env.MONGODB_DB || 'laboratorio_clinico_db')
    const documents = await database.collection('examenes_laboratorio').aggregate([
      { $sort: { fechaRealizacion: -1 } },
      { $limit: 50 },
      { $lookup: { from: 'pacientes', localField: 'pacienteId', foreignField: '_id', as: 'datosPaciente' } },
      { $unwind: { path: '$datosPaciente', preserveNullAndEmptyArrays: true } },
      { $project: { tipoExamen: 1, fechaRealizacion: 1, estadoExamen: 1, resultados: 1, paciente: '$datosPaciente.nombre' } },
    ]).toArray()
    res.json({ exams: documents.map((document) => ({
      id: document._id instanceof ObjectId ? document._id.toHexString() : String(document._id),
      patient: String(document.paciente || 'Paciente'),
      tipoExamen: String(document.tipoExamen || ''),
      fecha: document.fechaRealizacion instanceof Date ? document.fechaRealizacion.toISOString() : String(document.fechaRealizacion || ''),
      estado: String(document.estadoExamen || ''),
      results: Array.isArray(document.resultados) ? document.resultados : [],
    })) })
  } catch {
    res.status(503).json({ error: 'No se pudieron cargar los exámenes.' })
  }
})

app.post('/api/lab/exams', async (req, res) => {
  const session = requireSession(req, res)
  if (!session) return
  if (!canUseInstitution(session, 'laboratorio', res)) return
  if (!mongoClient) {
    res.status(503).json({ error: 'No se pudo guardar el examen.' })
    return
  }
  const body = req.body as Record<string, unknown>
  const patientId = typeof body.pacienteId === 'string' && ObjectId.isValid(body.pacienteId) ? new ObjectId(body.pacienteId) : null
  const type = typeof body.tipoExamen === 'string' ? body.tipoExamen.trim() : ''
  const date = typeof body.fechaRealizacion === 'string' ? new Date(body.fechaRealizacion) : new Date('invalid')
  const status = typeof body.estadoExamen === 'string' ? body.estadoExamen : ''
  const results = Array.isArray(body.resultados) ? body.resultados.filter((result): result is Record<string, unknown> => Boolean(result) && typeof result === 'object') : []
  if (!patientId || !type || Number.isNaN(date.getTime()) || !['PENDIENTE', 'PROCESANDO', 'COMPLETADO', 'ANULADO'].includes(status) || results.length === 0) {
    res.status(400).json({ error: 'Completa el paciente, tipo de examen, fecha y al menos un resultado.' })
    return
  }
  const normalizedResults = results.map((result) => ({
    parametro: typeof result.parametro === 'string' ? result.parametro.trim() : '',
    valor: typeof result.valor === 'string' ? result.valor.trim() : '',
    unidad: typeof result.unidad === 'string' ? result.unidad.trim() : '',
    rangoReferencia: typeof result.rangoReferencia === 'string' ? result.rangoReferencia.trim() : '',
    fueraDeRango: result.fueraDeRango === true,
  }))
  if (normalizedResults.some((result) => !result.parametro || !result.valor || !result.unidad)) {
    res.status(400).json({ error: 'Cada resultado necesita parámetro, valor y unidad.' })
    return
  }
  try {
    const client = await connectMongo()
    const database = client.db(process.env.MONGODB_DB || 'laboratorio_clinico_db')
    const patientExists = await database.collection('pacientes').findOne({ _id: patientId }, { projection: { _id: 1 } })
    if (!patientExists) {
      res.status(400).json({ error: 'El paciente seleccionado ya no existe.' })
      return
    }
    await database.collection('examenes_laboratorio').insertOne({
      pacienteId: patientId,
      tipoExamen: type,
      medicoSolicitante: typeof body.medicoSolicitante === 'string' ? body.medicoSolicitante.trim() : '',
      laboratorista: typeof body.laboratorista === 'string' ? body.laboratorista.trim() : '',
      fechaRealizacion: date,
      estadoExamen: status,
      resultados: normalizedResults,
      observaciones: typeof body.observaciones === 'string' ? body.observaciones.trim() : '',
    })
    res.status(201).json({ saved: true })
  } catch {
    res.status(503).json({ error: 'No se pudo guardar el examen. Revisa los datos e inténtalo de nuevo.' })
  }
})

app.get('/api/odontologia/records', async (req, res) => {
  const session = requireSession(req, res)
  if (!session) return
  if (!canUseInstitution(session, 'odontologia', res)) return
  const collectionName = typeof req.query.collection === 'string' ? req.query.collection : ''
  if (!dentalCollections.has(collectionName)) {
    res.status(404).json({ error: 'No existe este apartado.' })
    return
  }
  try {
    const snapshot = await getOdontologiaFirestore().collection(collectionName).limit(100).get()
    res.json({ records: snapshot.docs.map((document) => ({ id: document.id, data: serializeFirestoreValue(document.data()) })) })
  } catch (error) {
    console.error('No se pudieron cargar los registros odontológicos:', error)
    res.status(503).json({ error: 'No se pudieron cargar los registros. Revisa la configuración e inténtalo de nuevo.' })
  }
})

app.post('/api/odontologia/records', async (req, res) => {
  const session = requireSession(req, res)
  if (!session) return
  if (!canUseInstitution(session, 'odontologia', res)) return
  const body = req.body as { collection?: unknown; documentId?: unknown; data?: unknown }
  const collectionName = typeof body.collection === 'string' ? body.collection : ''
  const documentId = typeof body.documentId === 'string' ? body.documentId.trim() : ''
  if (!dentalCollections.has(collectionName) || !objectValue(body.data) || (documentId && !/^[A-Za-z0-9_-]{1,120}$/.test(documentId))) {
    res.status(400).json({ error: 'Revisa la colección y los campos del registro.' })
    return
  }
  const data = body.data
  const allowedFields = dentalCollectionFields[collectionName]
  if (Object.keys(data).some((key) => !allowedFields.has(key))) {
    res.status(400).json({ error: 'El registro contiene campos que no corresponden a esta colección.' })
    return
  }

  try {
  let document: Record<string, unknown> = { ...data }
  if (collectionName === 'pacientes') {
    const identification = data.identificacion
    if (!objectValue(identification) || typeof identification.tipo !== 'string' || typeof identification.numero !== 'string' ||
        typeof data.nombres !== 'string' || !data.nombres.trim() || typeof data.apellidos !== 'string' || !data.apellidos.trim() ||
        typeof data.fecha_nacimiento !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.fecha_nacimiento) ||
        (data.sexo !== undefined && typeof data.sexo !== 'string') || (data.telefono !== undefined && typeof data.telefono !== 'string') ||
        (data.correo !== undefined && typeof data.correo !== 'string') || (data.direccion !== undefined && typeof data.direccion !== 'string') ||
        (data.contacto_emergencia !== undefined && !objectValue(data.contacto_emergencia)) ||
        (data.anamnesis_medica !== undefined && !objectValue(data.anamnesis_medica)) ||
        (data.activo !== undefined && typeof data.activo !== 'boolean')) {
      res.status(400).json({ error: 'Completa los datos de identificación y contacto del paciente.' })
      return
    }
    document.fecha_creacion = new Date()
    if (document.activo === undefined) document.activo = true
  }

  if (collectionName === 'citas_odontologicas') {
    const appointmentDate = typeof data.fecha_programada === 'string' ? new Date(data.fecha_programada) : new Date('invalid')
    const states = ['PROGRAMADA', 'CONFIRMADA', 'EN_ATENCION', 'COMPLETADA', 'CANCELADA', 'NO_ASISTIO']
    if (typeof data.paciente_id !== 'string' || !data.paciente_id.trim() || typeof data.odontologo_id !== 'string' || !data.odontologo_id.trim() ||
        typeof data.odontologo_nombre !== 'string' || !data.odontologo_nombre.trim() || Number.isNaN(appointmentDate.getTime()) ||
        typeof data.duracion_minutos !== 'number' || data.duracion_minutos <= 0 || !Number.isFinite(data.duracion_minutos) ||
        typeof data.estado_cita !== 'string' || !states.includes(data.estado_cita) || typeof data.motivo !== 'string' || !data.motivo.trim() ||
        typeof data.sala_sillon_asignado !== 'string' || !data.sala_sillon_asignado.trim() ||
        (data.notas !== undefined && typeof data.notas !== 'string')) {
      res.status(400).json({ error: 'Completa paciente, odontólogo, horario, motivo y estado de la cita.' })
      return
    }
    const patient = await getOdontologiaFirestore().collection('pacientes').doc(data.paciente_id).get()
    if (!patient.exists) {
      res.status(400).json({ error: 'Selecciona un paciente que exista en el expediente.' })
      return
    }
    document.fecha_programada = appointmentDate
  }

  if (collectionName === 'historiales_odontologicos') {
    if (typeof data.paciente_id !== 'string' || !data.paciente_id.trim() || typeof data.numero_expediente !== 'string' || !data.numero_expediente.trim() ||
        !objectValue(data.odontograma_general) || !Array.isArray(data.sesiones_clinicas)) {
      res.status(400).json({ error: 'Completa el paciente, expediente, odontograma y sesiones clínicas.' })
      return
    }
    const firestore = getOdontologiaFirestore()
    const patient = await firestore.collection('pacientes').doc(data.paciente_id).get()
    if (!patient.exists) {
      res.status(400).json({ error: 'Selecciona un paciente que exista en el expediente.' })
      return
    }
    const existingHistory = await firestore.collection('historiales_odontologicos').where('paciente_id', '==', data.paciente_id).limit(1).get()
    if (!existingHistory.empty) {
      res.status(409).json({ error: 'Ese paciente ya tiene un historial odontológico.' })
      return
    }
    if (document.sesiones_clinicas === undefined) document.sesiones_clinicas = []
    document.ultima_actualizacion = new Date()
  }

    const firestore = getOdontologiaFirestore()
    const collection = firestore.collection(collectionName)
    const reference = documentId ? collection.doc(documentId) : collection.doc()
    await reference.create(document)
    res.status(201).json({ saved: true, id: reference.id })
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code || '') : ''
    if (code === '6' || code === 'already-exists') {
      res.status(409).json({ error: 'Ese ID de documento ya existe. Usa otro ID o deja que se genere automáticamente.' })
      return
    }
    console.error('No se pudo guardar el registro odontológico:', error)
    res.status(503).json({ error: 'No se pudo guardar. Revisa la configuración e inténtalo de nuevo.' })
  }
})

// Patient history is returned in one stable shape; each adapter translates its own model.
app.get('/api/overview',async(req,res)=>{
  const session=requireSession(req,res);if(!session)return
  const institution=requestedInstitution(req.query.institution,session,res);if(!institution||!canUseInstitution(session,institution,res))return
  try{
    let metrics:Array<{label:string;value:string;caption:string}>;let activity:Array<{kind:string;date:string;summary:string;detail?:string}>=[]
    if(institution==='hospital'&&postgresPool){const [patients,citas,consultas]=await Promise.all([postgresPool.query("SELECT COUNT(*)::text AS n FROM hospital_general.paciente WHERE estado='activo'"),postgresPool.query("SELECT COUNT(*)::text AS n FROM hospital_general.cita WHERE fecha=CURRENT_DATE AND estado IN ('programada','confirmada')"),postgresPool.query("SELECT COUNT(*)::text AS n FROM hospital_general.consulta WHERE estado='borrador'")]);metrics=[{label:'Expedientes activos',value:patients.rows[0].n,caption:'pacientes'},{label:'Citas de hoy',value:citas.rows[0].n,caption:'turnos'},{label:'Consultas abiertas',value:consultas.rows[0].n,caption:'por cerrar'}];const rows=await postgresPool.query(`SELECT c.fecha_hora,c.tipo,c.motivo,c.estado,concat(p.nombres,' ',p.apellidos) paciente FROM hospital_general.consulta c JOIN hospital_general.paciente p ON p.id_paciente=c.id_paciente ORDER BY c.fecha_hora DESC LIMIT 8`);activity=rows.rows.map(r=>({kind:`Consulta · ${r.tipo} · ${r.estado}`,date:new Date(r.fecha_hora).toISOString(),summary:String(r.paciente),detail:String(r.motivo)}))}
    else if(institution==='pediatria'&&mysqlPool){const [patients]=await mysqlPool.query<RowDataPacket[]>("SELECT COUNT(*) n FROM paciente WHERE estado='activo'");const [appointments]=await mysqlPool.query<RowDataPacket[]>("SELECT COUNT(*) n FROM cita WHERE fecha=CURDATE() AND estado IN ('programada','confirmada')");const [controls]=await mysqlPool.query<RowDataPacket[]>("SELECT COUNT(*) n FROM control_crecimiento WHERE DATE(fecha_hora)=CURDATE()");metrics=[{label:'Expedientes activos',value:String(patients[0]?.n||0),caption:'menores'},{label:'Citas de hoy',value:String(appointments[0]?.n||0),caption:'turnos'},{label:'Controles de hoy',value:String(controls[0]?.n||0),caption:'mediciones'}];const rows=await mysqlPool.query<RowDataPacket[]>(`SELECT c.fecha_hora,c.tipo,c.estado,c.motivo_consulta,CONCAT(p.nombres,' ',p.apellidos) paciente FROM consulta c JOIN paciente p ON p.id_paciente=c.id_paciente ORDER BY c.fecha_hora DESC LIMIT 8`);activity=rows[0].map(r=>({kind:`Consulta pediátrica · ${r.estado}`,date:new Date(r.fecha_hora).toISOString(),summary:String(r.paciente),detail:String(r.motivo_consulta)}))}
    else if(institution==='laboratorio'&&mongoClient){const client=await connectMongo();const db=client.db(process.env.MONGODB_DB||'laboratorio_clinico_db');const [patients,orders,pending,docs]=await Promise.all([db.collection('pacientes').countDocuments({estado:'ACTIVO'}),db.collection('examenes_laboratorio').countDocuments({}),db.collection('examenes_laboratorio').countDocuments({estadoExamen:{$in:['PENDIENTE','PROCESANDO']}}),db.collection('examenes_laboratorio').aggregate([{$sort:{fechaRealizacion:-1}},{$limit:8},{$lookup:{from:'pacientes',localField:'pacienteId',foreignField:'_id',as:'p'}},{$unwind:{path:'$p',preserveNullAndEmptyArrays:true}}]).toArray()]);metrics=[{label:'Pacientes activos',value:String(patients),caption:'expedientes'},{label:'Órdenes registradas',value:String(orders),caption:'total'},{label:'En proceso',value:String(pending),caption:'muestras'}];activity=docs.map(d=>({kind:`Examen · ${d.estadoExamen}`,date:new Date(d.fechaRealizacion).toISOString(),summary:String(d.tipoExamen),detail:String(d.p?.nombre||'Paciente')}))}
    else if(institution==='odontologia'){const db=getOdontologiaFirestore();const [patients,appointments,histories]=await Promise.all([db.collection('pacientes').where('activo','==',true).limit(300).get(),db.collection('citas_odontologicas').orderBy('fecha_programada','desc').limit(100).get(),db.collection('historiales_odontologicos').limit(300).get()]);const today=new Date();today.setHours(0,0,0,0);const tomorrow=new Date(today);tomorrow.setDate(tomorrow.getDate()+1);const todays=appointments.docs.filter(d=>{const value=d.data().fecha_programada?.toDate?.()||new Date(d.data().fecha_programada);return value>=today&&value<tomorrow});metrics=[{label:'Expedientes activos',value:String(patients.size),caption:'pacientes'},{label:'Citas de hoy',value:String(todays.length),caption:'turnos'},{label:'Historiales dentales',value:String(histories.size),caption:'expedientes'}];activity=appointments.docs.slice(0,8).map(d=>{const v=d.data();return{kind:`Cita dental · ${v.estado_cita}`,date:new Date(v.fecha_programada?.toDate?.()||v.fecha_programada).toISOString(),summary:String(v.odontologo_nombre||'Odontología'),detail:String(v.motivo||'')}})}
    else{res.status(503).json({error:'Motor institucional sin configuración.'});return}
    res.json({metrics,activity})
  }catch(error){console.error('No se pudo cargar el resumen institucional:',error);res.status(503).json({error:'No se pudo cargar la actividad real de la institución.'})}
})

app.get('/api/clinical/history', async (req, res) => {
  const session = requireSession(req, res)
  if (!session) return
  const institution = requestedInstitution(req.query.institution, session, res)
  if (!institution || !canUseInstitution(session, institution, res)) return
  const patientId = typeof req.query.patientId === 'string' ? req.query.patientId : ''
  if (!patientId) { res.status(400).json({ error: 'Selecciona un paciente.' }); return }
  try {
    let records: Array<{ kind: string; date: string; summary: string; detail?: string }> = []
    if (institution === 'hospital' && postgresPool) {
      const id = Number(patientId)
      const patient = await postgresPool.query('SELECT 1 FROM hospital_general.paciente WHERE id_paciente=$1', [id])
      if (!patient.rowCount) { res.status(404).json({ error: 'No existe ese paciente.' }); return }
      const [consultas, citas, antecedentes, alergias] = await Promise.all([
        postgresPool.query(`SELECT c.id_consulta,c.fecha_hora,c.tipo,c.motivo,c.enfermedad_actual,c.examen_fisico,c.evolucion,c.estado,
          COALESCE((SELECT string_agg(d.descripcion, '; ') FROM hospital_general.diagnostico d WHERE d.id_consulta=c.id_consulta),'Sin diagnóstico') diagnosticos,
          COALESCE((SELECT string_agg(t.descripcion, '; ') FROM hospital_general.tratamiento t WHERE t.id_consulta=c.id_consulta),'Sin tratamiento') tratamientos
          FROM hospital_general.consulta c WHERE c.id_paciente=$1 ORDER BY c.fecha_hora DESC LIMIT 100`, [id]),
        postgresPool.query('SELECT fecha,hora,motivo,estado FROM hospital_general.cita WHERE id_paciente=$1 ORDER BY fecha DESC,hora DESC LIMIT 100',[id]),
        postgresPool.query('SELECT fecha_registro,tipo,descripcion FROM hospital_general.antecedente WHERE id_paciente=$1 ORDER BY fecha_registro DESC LIMIT 100',[id]),
        postgresPool.query('SELECT fecha_registro,sustancia,reaccion,gravedad FROM hospital_general.alergia_paciente WHERE id_paciente=$1 ORDER BY fecha_registro DESC LIMIT 100',[id]),
      ])
      const [prescriptions]=await Promise.all([postgresPool.query(`SELECT r.id_consulta,string_agg(m.nombre||': '||dr.dosis||' · '||dr.frecuencia,'; ') AS detalle FROM hospital_general.receta r JOIN hospital_general.detalle_receta dr ON dr.id_receta=r.id_receta JOIN hospital_general.medicamento m ON m.id_medicamento=dr.id_medicamento JOIN hospital_general.consulta c ON c.id_consulta=r.id_consulta WHERE c.id_paciente=$1 GROUP BY r.id_consulta`,[id])])
      const prescriptionByConsultation=new Map(prescriptions.rows.map((r)=>[String(r.id_consulta),String(r.detalle)]))
      records = [
        ...consultas.rows.map((r) => ({ kind: `Consulta · ${r.tipo}`, date: new Date(r.fecha_hora).toISOString(), summary: String(r.motivo), detail: `${r.estado} · ${r.enfermedad_actual || ''} · Diagnóstico: ${r.diagnosticos} · Tratamiento: ${r.tratamientos} · Receta: ${prescriptionByConsultation.get(String(r.id_consulta))||'Sin receta'}` })),
        ...citas.rows.map((r) => ({ kind: `Cita · ${r.estado}`, date: `${r.fecha}T${r.hora}`, summary: String(r.motivo) })),
        ...antecedentes.rows.map((r) => ({ kind: `Antecedente · ${r.tipo}`, date: new Date(r.fecha_registro).toISOString(), summary: String(r.descripcion) })),
        ...alergias.rows.map((r) => ({ kind: `Alergia · ${r.gravedad}`, date: new Date(r.fecha_registro).toISOString(), summary: String(r.sustancia), detail: String(r.reaccion) })),
      ]
    } else if (institution === 'pediatria' && mysqlPool) {
      const id = Number(patientId)
      const [consultas] = await mysqlPool.execute<RowDataPacket[]>(`SELECT c.id_consulta,c.fecha_hora,c.tipo,c.motivo_consulta,c.examen_fisico,c.observaciones,c.estado,
        (SELECT GROUP_CONCAT(CONCAT(d.codigo_cie,' ',d.nombre) SEPARATOR '; ') FROM diagnostico d WHERE d.id_consulta=c.id_consulta) diagnosticos,
        (SELECT GROUP_CONCAT(CONCAT(m.nombre_comercial,': ',dr.dosis,' ',dr.frecuencia) SEPARATOR '; ') FROM receta r JOIN detalle_receta dr ON dr.id_receta=r.id_receta JOIN medicamento m ON m.id_medicamento=dr.id_medicamento WHERE r.id_consulta=c.id_consulta) recetas
        FROM consulta c WHERE c.id_paciente=? ORDER BY c.fecha_hora DESC LIMIT 100`, [id])
      const [citas] = await mysqlPool.execute<RowDataPacket[]>('SELECT fecha,hora,motivo,estado FROM cita WHERE id_paciente=? ORDER BY fecha DESC,hora DESC LIMIT 100',[id])
      const [growth] = await mysqlPool.execute<RowDataPacket[]>(`SELECT cc.fecha_hora,cc.peso_kg,cc.talla_cm,cc.imc,cc.estado_nutricional,c.id_paciente FROM control_crecimiento cc JOIN consulta c ON c.id_consulta=cc.id_consulta WHERE c.id_paciente=? ORDER BY cc.fecha_hora DESC LIMIT 100`,[id])
      const [vaccines] = await mysqlPool.execute<RowDataPacket[]>(`SELECT rv.fecha_aplicacion,v.nombre,rv.dosis_aplicada,rv.lote FROM registro_vacunacion rv JOIN vacuna v ON v.id_vacuna=rv.id_vacuna WHERE rv.id_paciente=? ORDER BY rv.fecha_aplicacion DESC LIMIT 100`,[id])
      const [allergies] = await mysqlPool.execute<RowDataPacket[]>('SELECT fecha_registro,sustancia,reaccion,gravedad FROM alergia_paciente WHERE id_paciente=? ORDER BY fecha_registro DESC LIMIT 100',[id])
      records = [...consultas.map((r) => ({kind:`Consulta · ${r.tipo}`,date:new Date(r.fecha_hora).toISOString(),summary:String(r.motivo_consulta),detail:`${r.estado} · ${r.examen_fisico} · Diagnóstico: ${r.diagnosticos||'Pendiente'} · Receta: ${r.recetas||'Sin receta'}`})),
        ...citas.map((r)=>({kind:`Cita · ${r.estado}`,date:`${r.fecha}T${r.hora}`,summary:String(r.motivo)})),
        ...growth.map((r)=>({kind:'Control de crecimiento',date:new Date(r.fecha_hora).toISOString(),summary:`${r.peso_kg} kg · ${r.talla_cm} cm · IMC ${r.imc}`,detail:String(r.estado_nutricional||'')})),
        ...vaccines.map((r)=>({kind:'Vacunación',date:new Date(r.fecha_aplicacion).toISOString(),summary:`${r.nombre} · dosis ${r.dosis_aplicada}`,detail:`Lote ${r.lote}`})),
        ...allergies.map((r)=>({kind:`Alergia · ${r.gravedad}`,date:new Date(r.fecha_registro).toISOString(),summary:String(r.sustancia),detail:String(r.reaccion)}))]
    } else if (institution === 'laboratorio' && mongoClient) {
      const client=await connectMongo(); const db=client.db(process.env.MONGODB_DB||'laboratorio_clinico_db'); const id=ObjectId.isValid(patientId)?new ObjectId(patientId):null
      if(!id){res.status(400).json({error:'Identificador de paciente inválido.'});return}
      const docs=await db.collection('examenes_laboratorio').find({pacienteId:id}).sort({fechaRealizacion:-1}).limit(100).toArray()
      records=docs.map((d)=>({kind:`Examen · ${d.estadoExamen}`,date:new Date(d.fechaRealizacion).toISOString(),summary:String(d.tipoExamen),detail:(Array.isArray(d.resultados)?d.resultados:[]).map((v:Record<string,unknown>)=>`${v.parametro}: ${v.valor} ${v.unidad}${v.fueraDeRango?' · Fuera de rango':''}`).join(' · ')}))
    } else if (institution === 'odontologia') {
      const db=getOdontologiaFirestore(); const [patient,history,appointments]=await Promise.all([db.collection('pacientes').doc(patientId).get(),db.collection('historiales_odontologicos').where('paciente_id','==',patientId).limit(1).get(),db.collection('citas_odontologicas').where('paciente_id','==',patientId).limit(100).get()])
      if(!patient.exists){res.status(404).json({error:'No existe ese paciente.'});return}
      const h=history.docs[0]?.data(); if(h) records.push({kind:'Odontograma',date:String(serializeFirestoreValue(h.ultima_actualizacion)||''),summary:`Expediente ${h.numero_expediente}`,detail:JSON.stringify(h.odontograma_general)})
      for(const doc of appointments.docs){const a=doc.data();records.push({kind:`Cita odontológica · ${a.estado_cita}`,date:new Date(a.fecha_programada?.toDate?.()||a.fecha_programada).toISOString(),summary:String(a.motivo),detail:`${a.odontologo_nombre} · ${a.sala_sillon_asignado}`})}
      for(const event of (h?.sesiones_clinicas||[])){records.push({kind:'Sesión clínica',date:new Date(event.fecha?.toDate?.()||event.fecha).toISOString(),summary:String(event.diagnostico||'Atención odontológica'),detail:String(event.procedimiento_realizado||'')})}
    } else { res.status(503).json({error:'Motor no configurado.'}); return }
    records.sort((a,b)=>b.date.localeCompare(a.date)); res.json({records})
  } catch(error) { console.error('No se pudo cargar el historial clínico:',error); res.status(503).json({error:'No se pudo cargar el historial clínico.'}) }
})

app.post('/api/odontologia/treatment', async (req,res)=>{
  const session=requireSession(req,res); if(!session)return; if(!canUseInstitution(session,'odontologia',res))return
  const {appointmentId,patientId,diagnostico,procedimiento,odontogramaPatch,insumos,receta,costo}=req.body||{}
  if(typeof appointmentId!=='string'||typeof patientId!=='string'||typeof diagnostico!=='string'||!diagnostico.trim()||typeof procedimiento!=='string'||!procedimiento.trim()||!objectValue(odontogramaPatch)||!Number.isFinite(Number(costo))){res.status(400).json({error:'Completa cita, diagnóstico, procedimiento y costo.'});return}
  try {
    const db=getOdontologiaFirestore(); const appointment=db.collection('citas_odontologicas').doc(appointmentId); const historyQuery=db.collection('historiales_odontologicos').where('paciente_id','==',patientId).limit(1)
    await db.runTransaction(async tx=>{const [a,hs]=await Promise.all([tx.get(appointment),tx.get(historyQuery)]); if(!a.exists||a.data()?.paciente_id!==patientId||!['PROGRAMADA','CONFIRMADA','EN_ATENCION'].includes(String(a.data()?.estado_cita)))throw new Error('CITA_NO_VALIDA'); const h=hs.docs[0];if(!h)throw new Error('HISTORIAL_NO_EXISTE');const current=h.data();const sessionEvent={cita_id:appointmentId,fecha:new Date(),odontologo_tratante:a.data()?.odontologo_nombre,diagnostico:diagnostico.trim(),procedimiento_realizado:procedimiento.trim(),insumos_utilizados:Array.isArray(insumos)?insumos.filter((v:unknown)=>typeof v==='string'):[],receta_farmacologica:Array.isArray(receta)?receta:[],costo_sesion:Number(costo)};tx.update(h.ref,{odontograma_general:{...(current.odontograma_general||{}),...odontogramaPatch},sesiones_clinicas:[...(current.sesiones_clinicas||[]),sessionEvent],ultima_actualizacion:new Date()});tx.update(appointment,{estado_cita:'COMPLETADA'})})
    res.status(201).json({saved:true})
  }catch(error){const message=error instanceof Error?error.message:'';if(message==='CITA_NO_VALIDA'||message==='HISTORIAL_NO_EXISTE'){res.status(400).json({error:message==='CITA_NO_VALIDA'?'La cita no corresponde a ese paciente.':'El paciente todavía no tiene historial odontológico.'});return}console.error('No se pudo guardar la sesión odontológica:',error);res.status(503).json({error:'No se pudo guardar la sesión clínica.'})}
})

app.listen(port, '127.0.0.1', () => {
  console.log(`API lista en http://127.0.0.1:${port}`)
})

async function closeConnections() {
  await postgresPool?.end()
  await mysqlPool?.end()
  if (mongoClient) await mongoClient.close()
}

process.once('SIGINT', () => { void closeConnections().finally(() => process.exit(0)) })
process.once('SIGTERM', () => { void closeConnections().finally(() => process.exit(0)) })
