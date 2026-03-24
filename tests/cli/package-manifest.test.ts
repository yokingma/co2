import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

type PackageJson = {
  name?: string
  private?: boolean
  license?: string
  files?: string[]
  publishConfig?: {
    access?: string
  }
  scripts?: Record<string, string>
  bin?: Record<string, string>
  engines?: Record<string, string>
  repository?: {
    type?: string
    url?: string
  }
}

async function loadPackageJson(): Promise<PackageJson> {
  const packageJsonPath = resolve(process.cwd(), 'package.json')
  const packageJsonContents = await readFile(packageJsonPath, 'utf8')
  return JSON.parse(packageJsonContents) as PackageJson
}

describe('package manifest', () => {
  it('is configured as a public scoped CLI package', async () => {
    const packageJson = await loadPackageJson()

    expect(packageJson.name).toBe('@fastagent/co2')
    expect(packageJson.private).not.toBe(true)
    expect(packageJson.publishConfig?.access).toBe('public')
    expect(packageJson.license).toBe('MIT')
    expect(packageJson.bin).toEqual({
      co2: 'dist/cli/index.js',
    })
  })

  it('publishes only runtime artifacts and release docs', async () => {
    const packageJson = await loadPackageJson()

    expect(packageJson.files).toEqual([
      'dist',
      'README.md',
      'CHANGELOG.md',
      'LICENSE',
    ])
  })

  it('runs validation before publish and build before packing', async () => {
    const packageJson = await loadPackageJson()

    expect(packageJson.scripts?.prepublishOnly).toBe('pnpm test && pnpm check')
    expect(packageJson.scripts?.prepack).toBe('pnpm build')
  })

  it('declares runtime metadata needed by npm consumers', async () => {
    const packageJson = await loadPackageJson()

    expect(packageJson.engines?.node).toBe('>=20.19.0')
    expect(packageJson.repository).toEqual({
      type: 'git',
      url: 'https://github.com/yokingma/co2',
    })
  })
})
