import { expect, test } from '@playwright/test'
import { fail, lastCall, openApp, pageState, reply } from './support'

async function settings(page: import('@playwright/test').Page, state = pageState()) {
  await openApp(page, state)
  await page.getByRole('button', { name: 'Settings' }).click()
}

test('settings keeps every control, including the model row', async ({ page }) => {
  await settings(page)
  await expect(page.getByLabel('Username')).toHaveValue('ada')
  await expect(page.getByLabel('Email')).toHaveValue('ada@example.com')
  await expect(page.getByLabel('Team')).toHaveValue('platform')
  await expect(page.getByRole('switch', { name: 'Cursor' })).toBeChecked()
  await expect(page.getByRole('switch', { name: 'Copilot' })).toBeDisabled()
  await expect(page.getByLabel('Model')).toBeEnabled()
  await expect(page.getByLabel('Model')).toHaveValue('composer')
  await expect(page.getByLabel('Local vault')).toHaveValue('C:\\vault')
  await expect(page.getByLabel('Auto-drop')).not.toBeChecked()
  await expect(page.getByLabel('Folder')).toHaveValue('C:\\drive')
  await expect(page.getByText('Learning tokens')).toBeVisible()
  await expect(page.getByText('0 tokens')).toBeVisible()
  await expect(page.getByLabel('Harvest cadence')).toHaveValue('30m')
  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled()
  await expect(page.getByLabel('Key')).toHaveCount(0)
  await expect(page.getByText('Expires')).toHaveCount(0)
})

test('the only provider can be switched off and the key stays hidden', async ({ page }) => {
  await settings(page)
  await expect(page.getByText('••••')).toHaveCount(0)
  await page.getByRole('switch', { name: 'Cursor' }).click()
  await reply(
    page,
    'action',
    pageState({ provider: '', model: '', models: [], savedProviders: ['cursor'], hasKey: true }),
  )
  await expect(page.getByRole('switch', { name: 'Cursor' })).not.toBeChecked()
  await expect(page.getByLabel('Model')).toHaveCount(0)
})

test('effort and fast come from the model catalog', async ({ page }) => {
  await settings(
    page,
    pageState({
      model: 'effort-model',
      modelParams: [
        { id: 'effort', value: 'high' },
        { id: 'fast', value: 'true' },
      ],
      models: [
        {
          id: 'effort-model',
          displayName: 'Effort Model',
          parameters: [
            {
              id: 'effort',
              displayName: 'Effort',
              values: [
                { value: 'low', displayName: 'Low' },
                { value: 'high', displayName: 'High' },
              ],
            },
            {
              id: 'fast',
              displayName: 'Fast',
              values: [{ value: 'false' }, { value: 'true' }],
            },
          ],
        },
      ],
      keyExpiresAt: '2026-11-01T00:00:00.000Z',
    }),
  )
  await expect(page.getByLabel('Effort')).toHaveValue('high')
  await expect(page.getByLabel('Fast')).toBeChecked()
  await expect(page.getByText('Expires 1 Nov 2026')).toBeVisible()
  await expect(page.getByText('sk-live-key')).toHaveCount(0)
})

test('save returns to an enabled Save after success and after failure', async ({ page }) => {
  await settings(page)
  const save = page.getByRole('button', { name: 'Save' })
  await page.getByLabel('Team').fill('labs')
  await save.click()
  await expect(page.getByRole('button', { name: 'Saving' })).toBeDisabled()
  await reply(page, 'action', pageState())
  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled()

  await page.getByLabel('Team').fill('other')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('button', { name: 'Saving' })).toBeDisabled()
  await fail(page, 'action', 'Could not save settings')
  await expect(page.getByText('Could not save settings')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled()
})

async function actionCall(page: import('@playwright/test').Page) {
  let call = await lastCall(page, 'action')
  const pending = await page.evaluate(
    () => window.__sharlieCalls?.some((item) => item.cmd === 'action' && !item.done) ?? false,
  )
  if (call === null || !pending) {
    await page.waitForFunction(
      () => window.__sharlieCalls?.some((item) => item.cmd === 'action' && !item.done) ?? false,
    )
    call = await lastCall(page, 'action')
  }
  return call
}

const catalogModels = [
  { id: 'composer', displayName: 'Composer' },
  { id: 'other-model', displayName: 'Other Model' },
]

function effortState(
  modelParams: { id: string; value: string }[] = [
    { id: 'effort', value: 'high' },
    { id: 'fast', value: 'true' },
  ],
) {
  return pageState({
    model: 'effort-model',
    modelParams,
    models: [
      {
        id: 'effort-model',
        displayName: 'Effort Model',
        parameters: [
          {
            id: 'effort',
            displayName: 'Effort',
            values: [
              { value: 'low', displayName: 'Low' },
              { value: 'high', displayName: 'High' },
            ],
          },
          {
            id: 'fast',
            displayName: 'Fast',
            values: [{ value: 'false' }, { value: 'true' }],
          },
        ],
      },
    ],
  })
}

test('profile save sends the new username, email, and team', async ({ page }) => {
  await settings(page)
  await page.getByLabel('Username').fill('labs-user')
  await page.getByLabel('Email').fill('labs@example.com')
  await page.getByLabel('Team').fill('labs')
  await page.getByRole('button', { name: 'Save' }).click()
  expect((await actionCall(page))?.payload).toEqual({
    action: 'save-profile',
    username: 'labs-user',
    email: 'labs@example.com',
    team: 'labs',
  })
  await reply(
    page,
    'action',
    pageState({ profile: { username: 'labs-user', email: 'labs@example.com', team: 'labs' } }),
  )
  await expect(page.getByLabel('Username')).toHaveValue('labs-user')
  await expect(page.getByLabel('Email')).toHaveValue('labs@example.com')
  await expect(page.getByLabel('Team')).toHaveValue('labs')
  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled()
})

test('adding an Anthropic key sends save-key and hides the secret', async ({ page }) => {
  await settings(page)
  await page.getByRole('button', { name: 'Add Anthropic key' }).click()
  const secret = page.getByLabel('Anthropic key')
  const saveKey = page.getByRole('button', { name: 'Save Anthropic key' })
  await expect(secret).toBeVisible()
  await expect(saveKey).toBeDisabled()
  await secret.fill('sk-test-secret')
  await expect(saveKey).toBeEnabled()
  await saveKey.click()
  expect((await actionCall(page))?.payload).toEqual({
    action: 'save-key',
    provider: 'anthropic',
    secret: 'sk-test-secret',
  })
  await reply(page, 'action', pageState({ savedProviders: ['cursor', 'anthropic'], hasKey: true }))
  await expect(page.getByText('sk-test-secret')).toHaveCount(0)
  await expect(secret).toHaveCount(0)
})

test('canceling an Anthropic key sends no action', async ({ page }) => {
  await settings(page)
  await page.getByRole('button', { name: 'Add Anthropic key' }).click()
  await expect(page.getByLabel('Anthropic key')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel Anthropic key' }).click()
  await expect(page.getByLabel('Anthropic key')).toHaveCount(0)
  expect(await lastCall(page, 'action')).toBeNull()
})

test('replacing the Cursor key sends save-key', async ({ page }) => {
  await settings(page)
  await page.getByRole('button', { name: 'Replace Cursor key' }).click()
  await page.getByLabel('Cursor key').fill('sk-replace-secret')
  await page.getByRole('button', { name: 'Save Cursor key' }).click()
  expect((await actionCall(page))?.payload).toEqual({
    action: 'save-key',
    provider: 'cursor',
    secret: 'sk-replace-secret',
  })
  await reply(page, 'action', pageState())
  await expect(page.getByText('sk-replace-secret')).toHaveCount(0)
})

test('removing the Cursor key sends revoke-key', async ({ page }) => {
  await settings(page)
  await page.getByRole('button', { name: 'Remove Cursor key' }).click()
  expect((await actionCall(page))?.payload).toEqual({ action: 'revoke-key', provider: 'cursor' })
  await reply(page, 'action', pageState({ savedProviders: [], hasKey: false, provider: '', model: '', models: [] }))
  await expect(page.getByRole('button', { name: 'Add Cursor key' })).toBeVisible()
})

test('a failed key save shows the error and enables Save Anthropic key again', async ({ page }) => {
  await settings(page)
  await page.getByRole('button', { name: 'Add Anthropic key' }).click()
  await page.getByLabel('Anthropic key').fill('sk-test-secret')
  await page.getByRole('button', { name: 'Save Anthropic key' }).click()
  await fail(page, 'action', 'Could not save the key')
  await expect(page.getByText('Could not save the key')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save Anthropic key' })).toBeEnabled()
})

test('a saved Copilot provider can be turned on', async ({ page }) => {
  await settings(page, pageState({ savedProviders: ['cursor', 'copilot'] }))
  const copilot = page.getByRole('switch', { name: 'Copilot' })
  await expect(copilot).toBeEnabled()
  await expect(copilot).not.toBeChecked()
  await copilot.click()
  expect((await actionCall(page))?.payload).toEqual({ action: 'activate-provider', provider: 'copilot' })
  await reply(page, 'action', pageState({ provider: 'copilot', savedProviders: ['cursor', 'copilot'] }))
  await expect(copilot).toBeChecked()
})

test('turning Cursor off sends clear-provider', async ({ page }) => {
  await settings(page)
  const cursor = page.getByRole('switch', { name: 'Cursor' })
  await cursor.click()
  expect((await actionCall(page))?.payload).toEqual({ action: 'clear-provider' })
  await reply(
    page,
    'action',
    pageState({ provider: '', model: '', models: [], savedProviders: ['cursor'], hasKey: true }),
  )
  await expect(cursor).not.toBeChecked()
})

test('a provider failure shows the error and leaves Copilot unchecked', async ({ page }) => {
  await settings(page, pageState({ savedProviders: ['cursor', 'copilot'] }))
  const copilot = page.getByRole('switch', { name: 'Copilot' })
  await copilot.click()
  await fail(page, 'action', 'Could not change the provider')
  await expect(page.getByText('Could not change the provider')).toBeVisible()
  await expect(copilot).not.toBeChecked()
})

test('changing the model sends select-model, including None', async ({ page }) => {
  await settings(page, pageState({ model: 'composer', models: catalogModels }))
  const model = page.getByLabel('Model')
  await model.selectOption('other-model')
  expect((await actionCall(page))?.payload).toEqual({ action: 'select-model', model: 'other-model' })
  await reply(page, 'action', pageState({ model: 'other-model', models: catalogModels }))
  await expect(model).toHaveValue('other-model')
  await model.selectOption('')
  expect((await actionCall(page))?.payload).toEqual({ action: 'select-model', model: '' })
  await reply(page, 'action', pageState({ model: '', models: catalogModels }))
  await expect(model).toHaveValue('')
})

test('a model failure shows the error', async ({ page }) => {
  await settings(page, pageState({ model: 'composer', models: catalogModels }))
  await page.getByLabel('Model').selectOption('other-model')
  await fail(page, 'action', 'Could not choose the model')
  await expect(page.getByText('Could not choose the model')).toBeVisible()
})

test('effort and fast send set-model-param', async ({ page }) => {
  await settings(page, effortState())
  await page.getByLabel('Effort').selectOption('low')
  expect((await actionCall(page))?.payload).toEqual({ action: 'set-model-param', id: 'effort', value: 'low' })
  await reply(
    page,
    'action',
    effortState([
      { id: 'effort', value: 'low' },
      { id: 'fast', value: 'true' },
    ]),
  )
  await page.getByLabel('Fast').click()
  expect((await actionCall(page))?.payload).toEqual({ action: 'set-model-param', id: 'fast', value: 'false' })
  await reply(
    page,
    'action',
    effortState([
      { id: 'effort', value: 'low' },
      { id: 'fast', value: 'false' },
    ]),
  )
  await expect(page.getByLabel('Fast')).not.toBeChecked()
})

test('a model option failure shows the error', async ({ page }) => {
  await settings(page, effortState())
  await page.getByLabel('Effort').selectOption('low')
  await fail(page, 'action', 'Could not set the model option')
  await expect(page.getByText('Could not set the model option')).toBeVisible()
})

test('vault, auto-drop, folder, and cadence save in that order', async ({ page }) => {
  await settings(page)
  const cadence = page.getByLabel('Harvest cadence')
  await expect(cadence.locator('option')).toHaveText(['15m', '30m', '1h', 'manual'])
  await page.getByLabel('Local vault').fill('D:\\vault')
  await page.getByLabel('Auto-drop').check()
  await page.getByLabel('Folder').fill('D:\\drive')
  await cadence.selectOption('15m')
  const kept = pageState({
    vaultPath: 'D:\\vault',
    autoDrop: true,
    drivePath: 'D:\\drive',
    cadence: '15m',
  })
  await page.getByRole('button', { name: 'Save' }).click()
  expect((await actionCall(page))?.payload).toEqual({ action: 'set-knowledge', path: 'D:\\vault' })
  await reply(page, 'action', kept)
  expect((await actionCall(page))?.payload).toEqual({ action: 'set-auto-drop', enabled: true })
  await reply(page, 'action', kept)
  expect((await actionCall(page))?.payload).toEqual({ action: 'set-drive', path: 'D:\\drive' })
  await reply(page, 'action', kept)
  expect((await actionCall(page))?.payload).toEqual({ action: 'set-cadence', cadence: '15m' })
  await reply(page, 'action', kept)
  await expect(page.getByLabel('Local vault')).toHaveValue('D:\\vault')
  await expect(page.getByLabel('Auto-drop')).toBeChecked()
  await expect(page.getByLabel('Folder')).toHaveValue('D:\\drive')
  await expect(cadence).toHaveValue('15m')
})

test('one unreported call renders the token line', async ({ page }) => {
  await settings(page, pageState({ learningTokensUnreported: 1 }))
  await expect(page.getByText('0 tokens · 1 call unreported', { exact: true })).toBeVisible()
})

test('the settings form scrolls and Save stays inside the viewport', async ({ page }) => {
  await settings(page)
  const form = page.locator('form').filter({ has: page.getByLabel('Local vault') })
  expect(await form.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  const header = await page.locator('header').boundingBox()
  expect(header?.height).toBe(48)
  const save = page.getByRole('button', { name: 'Save' })
  await save.scrollIntoViewIfNeeded()
  const box = await save.boundingBox()
  expect(box).toBeTruthy()
  if (!box) return
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(520)
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(680)
})
