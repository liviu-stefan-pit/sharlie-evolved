import neo4j from 'neo4j-driver'
import type { CypherStatement } from './cypher.ts'

export async function queryNeo4j(statement: string, parameters: Record<string, unknown>) {
  const uri = process.env.NEO4J_URI ?? ''
  const user = process.env.NEO4J_USER ?? ''
  const password = process.env.NEO4J_PASSWORD ?? ''
  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password))
  const session = driver.session()
  try {
    const result = await session.run(statement, parameters)
    return result.records.map((record) => record.toObject())
  } finally {
    await session.close()
    await driver.close()
  }
}

export async function writeCypher(
  statements: CypherStatement[],
  auth: { uri: string; user: string; password: string },
) {
  const driver = neo4j.driver(auth.uri, neo4j.auth.basic(auth.user, auth.password))
  const session = driver.session()
  try {
    await session.executeWrite(async (tx) => {
      for (const statement of statements) {
        await tx.run(statement.statement, statement.parameters)
      }
    })
  } finally {
    await session.close()
    await driver.close()
  }
}
