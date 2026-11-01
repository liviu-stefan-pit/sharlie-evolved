export type RelayAuthor = {
  username: string
  email?: string
  team?: string
}

export type RelayRelation = {
  entity?: string
  relation: string
  target_entity: string
}

export type RelayCard = {
  id: string
  title: string
  solution: string
  created_at: string
  sources?: string[]
  source_type?: string
  author: RelayAuthor
  relations?: RelayRelation[]
}

export type CypherStatement = {
  statement: string
  parameters: Record<string, string>
}

function nodeId(kind: string, name: string) {
  return `${kind}:${name.trim().toLowerCase()}`
}

function authored(card: RelayCard, sourceType: string): CypherStatement {
  const developerKey = (card.author.email || card.author.username).trim()
  return {
    statement: [
      'MERGE (developer:Developer {id: $developerId})',
      'SET developer.username = $username, developer.email = $email, developer.name = $username',
      'MERGE (card:Card {id: $cardId})',
      'SET card.id = $cardId, card.title = $title, card.solution = $solution, card.created_at = $createdAt, card.source_type = $sourceType',
      'MERGE (developer)-[:AUTHORED]->(card)',
    ].join('\n'),
    parameters: {
      developerId: nodeId('developer', developerKey),
      username: card.author.username.trim(),
      email: (card.author.email ?? '').trim(),
      cardId: card.id.trim(),
      title: card.title,
      solution: card.solution,
      createdAt: card.created_at,
      sourceType,
    },
  }
}

function appliesTo(cardId: string, toolName: string): CypherStatement {
  return {
    statement: [
      'MERGE (card:Card {id: $cardId})',
      'MERGE (tool:Tool {id: $toolId})',
      'SET tool.name = $toolName',
      'MERGE (card)-[:APPLIES_TO]->(tool)',
    ].join('\n'),
    parameters: {
      cardId,
      toolId: nodeId('tool', toolName),
      toolName: toolName.trim(),
    },
  }
}

function resolves(cardId: string, issueName: string): CypherStatement {
  return {
    statement: [
      'MERGE (card:Card {id: $cardId})',
      'MERGE (issue:Issue {id: $issueId})',
      'SET issue.name = $issueName',
      'MERGE (card)-[:RESOLVES]->(issue)',
    ].join('\n'),
    parameters: {
      cardId,
      issueId: nodeId('issue', issueName),
      issueName: issueName.trim(),
    },
  }
}

function warnsAgainst(cardId: string, patternName: string): CypherStatement {
  return {
    statement: [
      'MERGE (card:Card {id: $cardId})',
      'MERGE (pattern:AntiPattern {id: $patternId})',
      'SET pattern.name = $patternName',
      'MERGE (card)-[:WARNS_AGAINST]->(pattern)',
    ].join('\n'),
    parameters: {
      cardId,
      patternId: nodeId('antipattern', patternName),
      patternName: patternName.trim(),
    },
  }
}

function occursIn(issueName: string, toolName: string): CypherStatement {
  return {
    statement: [
      'MERGE (issue:Issue {id: $issueId})',
      'SET issue.name = $issueName',
      'MERGE (tool:Tool {id: $toolId})',
      'SET tool.name = $toolName',
      'MERGE (issue)-[:OCCURS_IN]->(tool)',
    ].join('\n'),
    parameters: {
      issueId: nodeId('issue', issueName),
      issueName: issueName.trim(),
      toolId: nodeId('tool', toolName),
      toolName: toolName.trim(),
    },
  }
}

function incompatible(leftName: string, rightName: string): CypherStatement {
  return {
    statement: [
      'MERGE (left:Tool {id: $leftId})',
      'SET left.name = $leftName',
      'MERGE (right:Tool {id: $rightId})',
      'SET right.name = $rightName',
      'MERGE (left)-[:INCOMPATIBLE_WITH]->(right)',
    ].join('\n'),
    parameters: {
      leftId: nodeId('tool', leftName),
      leftName: leftName.trim(),
      rightId: nodeId('tool', rightName),
      rightName: rightName.trim(),
    },
  }
}

export function cardFromUnknown(value: unknown): RelayCard | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const card = value as Record<string, unknown>
  const author = card.author
  if (!author || typeof author !== 'object' || Array.isArray(author)) return null
  const username = (author as { username?: unknown }).username
  if (typeof card.id !== 'string' || card.id.trim() === '') return null
  if (typeof card.title !== 'string') return null
  if (typeof card.solution !== 'string') return null
  if (typeof card.created_at !== 'string' || card.created_at.trim() === '') return null
  if (typeof username !== 'string' || username.trim() === '') return null
  const sources = Array.isArray(card.sources) ? card.sources.filter((source): source is string => typeof source === 'string') : []
  const relations = Array.isArray(card.relations)
    ? card.relations.flatMap((relation) => {
        if (!relation || typeof relation !== 'object') return []
        const row = relation as { entity?: unknown; relation?: unknown; target_entity?: unknown }
        if (typeof row.relation !== 'string' || typeof row.target_entity !== 'string') return []
        return [
          {
            entity: typeof row.entity === 'string' ? row.entity : '',
            relation: row.relation,
            target_entity: row.target_entity,
          },
        ]
      })
    : []
  return {
    id: card.id,
    title: card.title,
    solution: card.solution,
    created_at: card.created_at,
    sources,
    source_type: typeof card.source_type === 'string' ? card.source_type : undefined,
    author: {
      username,
      email: typeof (author as { email?: unknown }).email === 'string' ? (author as { email: string }).email : '',
      team: typeof (author as { team?: unknown }).team === 'string' ? (author as { team: string }).team : '',
    },
    relations,
  }
}

export function cardCypher(card: RelayCard): CypherStatement[] {
  const sourceType = (card.source_type || card.sources?.[0] || '').trim()
  const cardId = card.id.trim()
  const statements: CypherStatement[] = [authored(card, sourceType)]
  const seen = new Set<string>()
  function add(key: string, statement: CypherStatement) {
    if (seen.has(key)) return
    seen.add(key)
    statements.push(statement)
  }
  for (const relation of card.relations ?? []) {
    const target = relation.target_entity.trim()
    const entity = (relation.entity ?? '').trim()
    if (target === '') continue
    if (relation.relation === 'APPLIES_TO') add(`APPLIES_TO:${target.toLowerCase()}`, appliesTo(cardId, target))
    if (relation.relation === 'RESOLVES') add(`RESOLVES:${target.toLowerCase()}`, resolves(cardId, target))
    if (relation.relation === 'WARNS_AGAINST') add(`WARNS_AGAINST:${target.toLowerCase()}`, warnsAgainst(cardId, target))
    if (relation.relation === 'OCCURS_IN' && entity !== '') add(`OCCURS_IN:${entity.toLowerCase()}:${target.toLowerCase()}`, occursIn(entity, target))
    if (relation.relation === 'INCOMPATIBLE_WITH' && entity !== '') {
      add(`INCOMPATIBLE_WITH:${entity.toLowerCase()}:${target.toLowerCase()}`, incompatible(entity, target))
    }
  }
  for (const source of card.sources ?? []) {
    const name = source.trim()
    if (name === '') continue
    add(`APPLIES_TO:${name.toLowerCase()}`, appliesTo(cardId, name))
  }
  return statements
}
