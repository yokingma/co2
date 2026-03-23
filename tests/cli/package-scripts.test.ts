import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

type PackageJson = {
  scripts?: Record<string, string>
}

async function loadPackageJson(): Promise<PackageJson> {
  const packageJsonPath = resolve(process.cwd(), 'package.json')
  const packageJsonContents = await readFile(packageJsonPath, 'utf8')
  return JSON.parse(packageJsonContents) as PackageJson
}

describe('package scripts', () => {
  it('dev script invokes the CLI without forcing a repo-local config file', async () => {
    const packageJson = await loadPackageJson()

    expect(packageJson.scripts?.dev).toBe('tsx src/cli/index.ts start')
  })

  it('start script invokes the built CLI without forcing a repo-local config file', async () => {
    const packageJson = await loadPackageJson()

    expect(packageJson.scripts?.start).toBe('node dist/cli/index.js start')
  })
})
