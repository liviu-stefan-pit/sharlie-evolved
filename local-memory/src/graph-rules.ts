const fileExtensions = new Set([
  'html',
  'htm',
  'css',
  'scss',
  'sass',
  'js',
  'jsx',
  'ts',
  'tsx',
  'mjs',
  'cjs',
  'json',
  'pdf',
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'svg',
  'rs',
  'py',
  'go',
  'txt',
  'md',
  'vue',
  'svelte',
  'yml',
  'yaml',
  'toml',
  'xml',
  'wasm',
  'lock',
  'sh',
  'ps1',
])

const learningSources = new Set([
  'cursor',
  'copilot',
  'claude',
  'cursor-cli',
  'claude-cli',
  'copilot-cli',
])

export function isFileMention(value: string) {
  const text = value.trim()
  if (text.includes('/') || text.includes('\\')) return true
  const extension = text.match(/\.([^.]+)$/)?.[1]?.toLowerCase()
  return extension != null && fileExtensions.has(extension)
}

export function isLearningSource(value: string) {
  return learningSources.has(value.trim().toLowerCase())
}
