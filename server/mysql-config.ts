import type { PoolOptions } from 'mysql2/promise'

export function mysqlConfigFromEnv(): PoolOptions | null {
  const host = process.env.MYSQL_HOST?.trim()
  const database = process.env.MYSQL_DATABASE?.trim()
  const user = process.env.MYSQL_USER?.trim()
  if (!host || !database || !user) return null

  const port = Number(process.env.MYSQL_PORT || 3306)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('MYSQL_PORT debe ser un número entre 1 y 65535.')
  }

  return {
    host,
    port,
    database,
    user,
    password: process.env.MYSQL_PASSWORD || undefined,
    waitForConnections: true,
    connectionLimit: 8,
    queueLimit: 0,
    timezone: '-06:00',
    dateStrings: true,
  }
}
