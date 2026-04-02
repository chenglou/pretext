import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const appRoot = process.cwd()
const dataDir = path.join(appRoot, 'data')
const dbPath = path.join(dataDir, 'masonry.sqlite')
const seedPath = path.join(dataDir, 'shower-thoughts.json')

function runSql(args) {
  return execFileSync('sqlite3', args, {
    encoding: 'utf8',
  }).trim()
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function parseJsonResult(sql) {
  return JSON.parse(runSql(['-json', dbPath, sql]) || '[]')
}

function columnExists(columnName) {
  const columns = parseJsonResult('PRAGMA table_info(thoughts);')
  return columns.some(column => column.name === columnName)
}

function ensureDb() {
  mkdirSync(dataDir, { recursive: true })

  runSql([
    dbPath,
    `
      CREATE TABLE IF NOT EXISTS thoughts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_index INTEGER NOT NULL UNIQUE,
        body TEXT NOT NULL
      );
    `,
  ])

  if (!columnExists('is_favorite')) {
    runSql([dbPath, 'ALTER TABLE thoughts ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;'])
  }

  if (!columnExists('is_hidden')) {
    runSql([dbPath, 'ALTER TABLE thoughts ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0;'])
  }

  const countRows = parseJsonResult('SELECT COUNT(*) AS count FROM thoughts;')
  const count = countRows[0]?.count ?? 0

  if (count === 0) seedThoughts()
}

function seedThoughts() {
  const thoughts = JSON.parse(readFileSync(seedPath, 'utf8'))
  const statements = [
    'BEGIN TRANSACTION;',
    'DELETE FROM thoughts;',
  ]

  for (let index = 0; index < thoughts.length; index += 1) {
    statements.push(
      `INSERT INTO thoughts (source_index, body, is_favorite, is_hidden) VALUES (${index}, ${sqlString(thoughts[index])}, 0, 0);`,
    )
  }

  statements.push('COMMIT;')
  runSql([dbPath, statements.join('\n')])
}

function normalizeThought(row) {
  return {
    id: row.id,
    sourceIndex: row.sourceIndex,
    body: row.body,
    isFavorite: Boolean(row.isFavorite),
    isHidden: Boolean(row.isHidden),
  }
}

function getThoughtById(id) {
  const rows = parseJsonResult(
    `SELECT id, source_index AS sourceIndex, body, is_favorite AS isFavorite, is_hidden AS isHidden FROM thoughts WHERE id = ${id} LIMIT 1;`,
  )

  return rows[0] ? normalizeThought(rows[0]) : null
}

export function getThoughts() {
  ensureDb()

  if (!existsSync(dbPath)) return []

  const rows = parseJsonResult(
    'SELECT id, source_index AS sourceIndex, body, is_favorite AS isFavorite, is_hidden AS isHidden FROM thoughts ORDER BY source_index ASC;',
  )

  return rows.map(normalizeThought)
}

export function setThoughtFavorite(id, isFavorite) {
  ensureDb()
  runSql([dbPath, `UPDATE thoughts SET is_favorite = ${isFavorite ? 1 : 0} WHERE id = ${id};`])
  return getThoughtById(id)
}

export function setThoughtHidden(id, isHidden) {
  ensureDb()
  runSql([dbPath, `UPDATE thoughts SET is_hidden = ${isHidden ? 1 : 0} WHERE id = ${id};`])
  return getThoughtById(id)
}

export function resetHiddenThoughts() {
  ensureDb()
  runSql([dbPath, 'UPDATE thoughts SET is_hidden = 0 WHERE is_hidden = 1;'])

  const rows = parseJsonResult('SELECT COUNT(*) AS count FROM thoughts WHERE is_hidden = 0;')
  return {
    visibleCount: rows[0]?.count ?? 0,
  }
}

export function resetThoughtState() {
  ensureDb()
  runSql([dbPath, 'UPDATE thoughts SET is_favorite = 0, is_hidden = 0;'])

  return {
    ok: true,
  }
}
