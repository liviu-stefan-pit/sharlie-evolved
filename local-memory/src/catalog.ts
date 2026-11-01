export type ModelParameterValue = { id: string; value: string }

export type CatalogParameter = {
  id: string
  displayName?: string
  values: { value: string; displayName?: string }[]
}

export type CatalogVariant = {
  params: ModelParameterValue[]
  displayName: string
  isDefault?: boolean
}

type CatalogModel = {
  parameters?: CatalogParameter[]
  variants?: CatalogVariant[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function allows(parameter: CatalogParameter, value: string) {
  return parameter.values.some((item) => item.value === value)
}

export function isFlagParameter(parameter: CatalogParameter) {
  if (parameter.values.length !== 2) return false
  const values = parameter.values.map((item) => item.value)
  return values.includes('true') && values.includes('false')
}

export function resolveParams(model: CatalogModel, requested: readonly ModelParameterValue[]): ModelParameterValue[] {
  const defaultVariant = model.variants?.find((variant) => variant.isDefault === true)
  const params: ModelParameterValue[] = []
  for (const parameter of model.parameters ?? []) {
    if (parameter.values.length === 0) continue
    const asked = requested.find((item) => item.id === parameter.id)
    if (asked && allows(parameter, asked.value)) {
      params.push({ id: parameter.id, value: asked.value })
      continue
    }
    const preferred = defaultVariant?.params.find((item) => item.id === parameter.id)
    if (preferred && allows(parameter, preferred.value)) {
      params.push({ id: parameter.id, value: preferred.value })
      continue
    }
    params.push({ id: parameter.id, value: parameter.values[0].value })
  }
  return params
}

export function defaultParams(model: CatalogModel) {
  return resolveParams(model, [])
}

export function parseSavedParams(value: unknown): ModelParameterValue[] {
  if (!Array.isArray(value)) return []
  const params: ModelParameterValue[] = []
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== 'string' || item.id === '' || typeof item.value !== 'string') return []
    params.push({ id: item.id, value: item.value })
  }
  return params
}

export function catalogParameters(value: unknown): CatalogParameter[] {
  if (!Array.isArray(value)) return []
  const parameters: CatalogParameter[] = []
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== 'string' || item.id === '' || !Array.isArray(item.values)) continue
    const values: CatalogParameter['values'] = []
    for (const entry of item.values) {
      if (!isRecord(entry) || typeof entry.value !== 'string') continue
      values.push({
        value: entry.value,
        ...(typeof entry.displayName === 'string' && entry.displayName !== '' ? { displayName: entry.displayName } : {}),
      })
    }
    if (values.length === 0) continue
    parameters.push({
      id: item.id,
      ...(typeof item.displayName === 'string' && item.displayName !== '' ? { displayName: item.displayName } : {}),
      values,
    })
  }
  return parameters
}

export function catalogVariants(value: unknown): CatalogVariant[] {
  if (!Array.isArray(value)) return []
  const variants: CatalogVariant[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const params = parseSavedParams(item.params)
    if (params.length === 0 && item.params != null && !Array.isArray(item.params)) continue
    variants.push({
      params,
      displayName: typeof item.displayName === 'string' ? item.displayName : '',
      ...(item.isDefault === true ? { isDefault: true } : {}),
    })
  }
  return variants
}
