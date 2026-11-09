import type { PoolConfig } from 'pg'

export function postgresConfigFromEnv(): PoolConfig | null {
  const ssl = /^(1|true|yes)$/i.test(process.env.POSTGRES_SSL || '') ? { rejectUnauthorized: true } : undefined
  const host = process.env.POSTGRES_HOST?.trim()
  const database = process.env.POSTGRES_DATABASE?.trim()
  const user = process.env.POSTGRES_USER?.trim()

  if (host && database && user) {
    const parsedPort = Number(process.env.POSTGRES_PORT || 5432)
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      throw new Error('POSTGRES_PORT debe ser un número entre 1 y 65535.')
    }
    return {
      host,
      port: parsedPort,
      database,
      user,
      password: process.env.POSTGRES_PASSWORD || undefined,
      ssl,
    }
  }

  const connectionString = process.env.POSTGRES_URL?.trim()
  return connectionString ? { connectionString, ssl } : null
}
