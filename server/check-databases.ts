import 'dotenv/config'
import { MongoClient } from 'mongodb'
import { Pool } from 'pg'
import mysql, { type RowDataPacket } from 'mysql2/promise'
import { applicationDefault, deleteApp, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { postgresConfigFromEnv } from './postgres-config.ts'
import { mysqlConfigFromEnv } from './mysql-config.ts'

function classifyFailure(error: unknown): string {
  if (!error || typeof error !== 'object') return 'Error inesperado.'
  const detail = error as { code?: string | number; name?: string; message?: string }
  const code = String(detail.code || '')

  if (code === '28P01' || code === '18') return 'Autenticación rechazada: revisa usuario y contraseña.'
  if (code === 'ER_ACCESS_DENIED_ERROR' || code === '1045') return 'Autenticación rechazada: revisa usuario y contraseña de MySQL.'
  if (code === 'ER_BAD_DB_ERROR' || code === '1049') return 'La conexión respondió, pero no existe esa base de datos MySQL.'
  if (code === '28000') return 'El servidor rechazó el acceso; revisa permisos y si requiere SSL.'
  if (code === '3D000') return 'La conexión respondió, pero no existe esa base de datos.'
  if (code === '3F000') return 'La conexión respondió, pero no existe el esquema requerido.'
  if (code === '42P01') return 'La conexión respondió, pero falta una tabla requerida.'
  if (code === 'ENOTFOUND') return 'No se pudo resolver el host indicado en la URI.'
  if (code === 'ECONNREFUSED') return 'El host rechazó la conexión; revisa host y puerto.'
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return 'Se agotó el tiempo de conexión; revisa host, puerto, firewall y acceso de red.'
  if (code === 'EAI_FAIL' || code === 'EAI_AGAIN') return 'No se pudo resolver el host indicado; revisa el valor de host.'
  if (code === 'ECONNRESET' || code === 'EHOSTUNREACH' || code === 'EAI_AGAIN') return 'Falló la comunicación de red con el servidor.'
  if (code === 'SELF_SIGNED_CERT_IN_CHAIN' || code === 'CERT_HAS_EXPIRED' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') return 'Falló la validación del certificado SSL.'
  if (code === 'ERR_INVALID_URL') return 'La URI no tiene un formato válido.'
  if (detail.name === 'MongoServerSelectionError') return 'No se alcanzó el cluster; revisa host, red y lista de IP permitidas en Atlas.'
  if (detail.name === 'MongoNetworkError') return 'Falló la comunicación de red con el cluster.'
  return 'La conexión falló. Revisa la URI, permisos y disponibilidad del servidor.'
}

function safeErrorTag(error: unknown): string {
  if (!error || typeof error !== 'object') return 'desconocido'
  const detail = error as { code?: string | number; name?: string }
  const tag = detail.code ? String(detail.code) : detail.name || 'desconocido'
  return /^[A-Za-z0-9_.-]{1,40}$/.test(tag) ? tag : 'desconocido'
}

async function checkPostgres(): Promise<boolean> {
  let config
  try {
    config = postgresConfigFromEnv()
  } catch {
    console.log('PostgreSQL: POSTGRES_PORT no es válido.')
    return false
  }
  if (!config) {
    console.log('PostgreSQL: sin configurar. Completa host, base, usuario y contraseña en el archivo local.')
    return false
  }

  const pool = new Pool({ ...config, connectionTimeoutMillis: 8_000 })

  try {
    await pool.query('SELECT 1')
    const tables = await pool.query(
      `SELECT to_regclass('hospital_general.paciente') AS paciente,
              to_regclass('hospital_general.telefono_paciente') AS telefono`,
    )
    const missing = Object.entries(tables.rows[0] as Record<string, string | null>)
      .filter(([, value]) => !value)
      .map(([name]) => name)
    if (missing.length) {
      console.log(`PostgreSQL: conexión establecida; faltan las tablas requeridas: ${missing.join(', ')}.`)
      return false
    }
    console.log('PostgreSQL: conexión establecida; tablas requeridas encontradas.')
    return true
  } catch (error) {
    console.log(`PostgreSQL: ${classifyFailure(error)} (código/tipo: ${safeErrorTag(error)}).`)
    return false
  } finally {
    await pool.end()
  }
}

async function checkMongo(): Promise<boolean> {
  const uri = process.env.MONGODB_URI
  if (!uri) {
    console.log('MongoDB: sin configurar (MONGODB_URI está vacío).')
    return false
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8_000 })
  try {
    await client.connect()
    await client.db('admin').command({ ping: 1 })
    const database = client.db(process.env.MONGODB_DB || 'laboratorio_clinico_db')
    const names = new Set((await database.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name))
    const missing = ['pacientes', 'examenes_laboratorio'].filter((name) => !names.has(name))
    if (missing.length) {
      console.log(`MongoDB: conexión establecida; faltan las colecciones requeridas: ${missing.join(', ')}.`)
      return false
    }
    console.log('MongoDB: conexión establecida; colecciones requeridas encontradas.')
    return true
  } catch (error) {
    console.log(`MongoDB: ${classifyFailure(error)} (código/tipo: ${safeErrorTag(error)}).`)
    return false
  } finally {
    await client.close()
  }
}

async function checkMysql(): Promise<boolean> {
  let config
  try {
    config = mysqlConfigFromEnv()
  } catch {
    console.log('MySQL: MYSQL_PORT no es válido.')
    return false
  }
  if (!config) {
    console.log('MySQL: sin configurar. Completa MYSQL_HOST, MYSQL_DATABASE y MYSQL_USER en el archivo local.')
    return false
  }

  const pool = mysql.createPool({ ...config, connectTimeout: 8_000, connectionLimit: 1 })
  try {
    await pool.query('SELECT 1')
    const [rows] = await pool.execute<Array<RowDataPacket & { total: number }>>(
      `SELECT COUNT(*) AS total FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'paciente'`,
    )
    if (Number(rows[0]?.total || 0) === 0) {
      console.log('MySQL: conexión establecida; falta la tabla requerida paciente.')
      return false
    }
    console.log('MySQL: conexión establecida; tabla paciente encontrada.')
    return true
  } catch (error) {
    console.log(`MySQL: ${classifyFailure(error)} (código/tipo: ${safeErrorTag(error)}).`)
    return false
  } finally {
    await pool.end()
  }
}

async function checkFirebase(): Promise<boolean> {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim()
  if (!projectId) {
    console.log('Firebase: sin configurar (FIREBASE_PROJECT_ID está vacío).')
    return false
  }
  if (!process.env.FIRESTORE_EMULATOR_HOST && !process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) {
    console.log('Firebase: sin configurar. Indica el archivo de credenciales o usa FIRESTORE_EMULATOR_HOST.')
    return false
  }

  let app
  try {
    app = initializeApp({ credential: applicationDefault(), projectId }, 'database-check')
    const firestore = getFirestore(app)
    const names = ['pacientes', 'citas_odontologicas', 'historiales_odontologicos']
    const counts = await Promise.all(names.map(async (name) => {
      const snapshot = await firestore.collection(name).limit(1).get()
      return `${name}: ${snapshot.size ? 'con documentos' : 'vacía'}`
    }))
    console.log(`Firebase: conexión establecida en ${projectId}; ${counts.join(', ')}.`)
    return true
  } catch (error) {
    console.log(`Firebase: ${classifyFailure(error)} (código/tipo: ${safeErrorTag(error)}).`)
    return false
  } finally {
    if (app) await deleteApp(app).catch(() => undefined)
  }
}

const results = await Promise.all([checkPostgres(), checkMysql(), checkMongo(), checkFirebase()])
if (results.some((connected) => !connected)) process.exitCode = 1
