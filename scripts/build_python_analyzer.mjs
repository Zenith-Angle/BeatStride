import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = dirname(scriptDir)
const analyzerRoot = join(repoRoot, 'python-analyzer')
const entryScript = join(analyzerRoot, 'beatstride_analyzer.py')
const requirementsFile = join(analyzerRoot, 'requirements.txt')
const distDir = join(analyzerRoot, 'dist')
const exePath = join(distDir, 'beatstride-analyzer.exe')
const resourceDir = join(repoRoot, 'resources', 'python-analyzer')
const pyInstallerBuildDir = join(repoRoot, 'build')
const pyInstallerSpecFile = join(repoRoot, 'beatstride-analyzer.spec')

function fail(message) {
  console.error(message)
  process.exit(1)
}

function resolvePythonCommand() {
  const candidates =
    process.platform === 'win32'
      ? [
          { command: 'py', prefixArgs: ['-3'] },
          { command: 'python', prefixArgs: [] }
        ]
      : [
          { command: 'python3', prefixArgs: [] },
          { command: 'python', prefixArgs: [] }
        ]

  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, [...candidate.prefixArgs, '--version'], {
      stdio: 'pipe',
      encoding: 'utf8'
    })
    if (!result.error && result.status === 0) {
      return candidate
    }
  }

  fail('Python 3 interpreter not found.')
}

function runPython(python, args, options = {}) {
  const result = spawnSync(python.command, [...python.prefixArgs, ...args], {
    stdio: 'inherit',
    ...options
  })

  if (result.error) {
    fail(result.error.message)
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status)
  }
}

if (!existsSync(entryScript)) {
  fail(`Analyzer entry script not found: ${entryScript}`)
}

const python = resolvePythonCommand()
const dependencyCheckScript = [
  'import importlib',
  "required = ('librosa', 'numpy', 'PyInstaller')",
  'missing = []',
  'for module_name in required:',
  '    try:',
  '        importlib.import_module(module_name)',
  '    except Exception:',
  '        missing.append(module_name)',
  'raise SystemExit(0 if not missing else 1)'
].join('\n')

const dependencyCheck = spawnSync(
  python.command,
  [...python.prefixArgs, '-c', dependencyCheckScript],
  {
    stdio: 'pipe',
    encoding: 'utf8'
  }
)

if (dependencyCheck.error) {
  fail(dependencyCheck.error.message)
}

if (dependencyCheck.status !== 0) {
  const pythonCommand = [python.command, ...python.prefixArgs].join(' ')
  fail(
    `Missing Python dependencies. Install them first with: ${pythonCommand} -m pip install -r ${requirementsFile}`
  )
}

runPython(python, [
  '-m',
  'PyInstaller',
  '--noconfirm',
  '--clean',
  '--onefile',
  '--name',
  'beatstride-analyzer',
  entryScript,
  '--distpath',
  distDir
])

if (!existsSync(exePath)) {
  fail(`Analyzer executable was not created: ${exePath}`)
}

mkdirSync(resourceDir, { recursive: true })
copyFileSync(exePath, join(resourceDir, 'beatstride-analyzer.exe'))

if (existsSync(pyInstallerBuildDir)) {
  rmSync(pyInstallerBuildDir, { recursive: true, force: true })
}

if (existsSync(pyInstallerSpecFile)) {
  rmSync(pyInstallerSpecFile, { force: true })
}

console.log(`Built and copied beatstride-analyzer.exe to ${resourceDir}`)
