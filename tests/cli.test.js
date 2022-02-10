const path = require('path')
const fs = require('fs')
const os = require('os')
const { execSync } = require('child_process')

const cliPath = path.resolve(process.cwd(), './lib/cli.js')

function exec(args) {
  return execSync(args).toString()
}

it('works', () => {
  try {
    fs.rmSync(path.resolve(process.cwd(), './tailwind.config.js'))
  } catch { }

  const result = exec(`node ${cliPath} init`)

  expect(result).toContain('Created Tailwind CSS config file: tailwind.config.js')

  fs.rmSync(path.resolve(process.cwd(), './tailwind.config.js'))
})

// This whole weird dance is to ensure we're in an isolated
// environment where postcss can't be picked up automatically
it('works even when postcss cannot be found', () => {
  // 1. Build a production version
  exec('npm run prepublishOnly')

  // 2. Package it
  const dir = fs.mkdtempSync(`${os.tmpdir()}${path.sep}tailwindcss-cli-`)

  const [pkg] = JSON.parse(exec(`npm pack --json`))

  exec(`npm pack`)
  fs.renameSync(pkg.filename, path.resolve(dir, 'tailwindcss.tgz'))

  // 3. Move to the temp directory and install the package
  process.chdir(dir)
  exec(`npm init -yf`)
  exec(`npm install ./tailwindcss.tgz --legacy-peer-deps`)

  // 4. Generate a new Tailwind config
  console.log(process.cwd())

  try {
    fs.rmSync(path.resolve(process.cwd(), './tailwind.config.js'))
  } catch { }

  const result = exec('node ./node_modules/.bin/tailwindcss init')

  expect(result).toContain('Created Tailwind CSS config file: tailwind.config.js')

  fs.rmSync(path.resolve(process.cwd(), './tailwind.config.js'))
})
