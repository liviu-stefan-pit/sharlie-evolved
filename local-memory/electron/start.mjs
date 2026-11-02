const main = new URL('./dist/main.mjs', import.meta.url)

try {
  await import(main.href)
} catch (error) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (code === 'ERR_MODULE_NOT_FOUND') {
    console.error('Sharlie is not compiled. Run npm run compile in local-memory, then start again.')
  }
  throw error
}
