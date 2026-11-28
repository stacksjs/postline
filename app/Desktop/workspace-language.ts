import process from 'node:process'

export const WORKSPACE_LANGUAGE_ASSET = 'postline-workspace-language.txt'

/** Use the language shipped with the compiled views, including after a Finder launch. */
export async function loadBundledWorkspaceLanguage(): Promise<void> {
  const language = Bun.embeddedFiles.find((file: Blob & { name?: string }) =>
    /^postline-workspace-language(?:-[a-z0-9]+)?\.txt$/i.test(file.name?.split('/').at(-1) ?? ''),
  )
  if (!language) return

  const value = await language.text()
  if (value !== 'en' && value !== 'es')
    throw new Error('The desktop workspace language in the app bundle is invalid.')
  process.env.POSTLINE_WORKSPACE_LOCALE = value
}
