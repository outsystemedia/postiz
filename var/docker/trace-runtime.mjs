/**
 * DesignerPRO addition — not upstream Postiz code.
 *
 * Produces the small runtime filesystem used by Dockerfile.dev. The root
 * workspace declares frontend, backend and build-time packages together, so
 * `pnpm install --prod` still weighs several gigabytes. Node File Trace starts
 * from the two compiled Nest entrypoints and copies their transitive runtime
 * files only; Next.js produces its own standalone runtime for the frontend.
 */
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readlink,
  readdir,
  rm,
  symlink
} from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { nodeFileTrace } = require('next/dist/compiled/@vercel/nft')

const sourceRoot = process.cwd()
const args = new Set(process.argv.slice(2))
const outputFlag = process.argv.indexOf('--output')
const outputDirectory = path.resolve(
	outputFlag >= 0 && process.argv[outputFlag + 1] ? process.argv[outputFlag + 1] : '/runtime'
)
const skipFrontend = args.has('--skip-frontend')

if (outputDirectory === sourceRoot || outputDirectory.startsWith(`${sourceRoot}${path.sep}`)) {
	throw new Error('Runtime output must be outside the source workspace')
}

const backendEntry = 'apps/backend/dist/apps/backend/src/main.js'
const orchestratorEntry = 'apps/orchestrator/dist/apps/orchestrator/src/main.js'
const prismaCliEntry = 'node_modules/prisma/build/index.js'

function sourcePath(relativePath) {
	const resolved = path.resolve(sourceRoot, relativePath)
	if (resolved !== sourceRoot && !resolved.startsWith(`${sourceRoot}${path.sep}`)) {
		throw new Error(`Refusing to copy a path outside the workspace: ${relativePath}`)
	}
	return resolved
}

async function copyTree(source, destination) {
	const metadata = await lstat(source)
	if (metadata.isSymbolicLink()) {
		await mkdir(path.dirname(destination), { recursive: true })
		await rm(destination, { force: true, recursive: true })
		await symlink(await readlink(source), destination)
		return
	}

	if (metadata.isDirectory()) {
		await mkdir(destination, { recursive: true })
		for (const entry of await readdir(source)) {
			await copyTree(path.join(source, entry), path.join(destination, entry))
		}
		return
	}

	await mkdir(path.dirname(destination), { recursive: true })
	await copyFile(source, destination)
	await chmod(destination, metadata.mode)
}

async function copyRelative(relativePath) {
	await copyTree(sourcePath(relativePath), path.join(outputDirectory, relativePath))
}

await rm(outputDirectory, { force: true, recursive: true })
await mkdir(outputDirectory, { recursive: true })

const { fileList, warnings } = await nodeFileTrace(
	[backendEntry, orchestratorEntry, prismaCliEntry],
	{
		base: sourceRoot,
		processCwd: sourceRoot,
		mixedModules: true
	}
)

for (const relativePath of fileList) {
	if (relativePath === 'node_modules') {
		throw new Error('Trace unexpectedly selected the complete node_modules directory')
	}
	await copyRelative(relativePath)
}

// Prisma loads engines and generated client files dynamically. Preserve its
// compact package directories in full rather than relying on static tracing.
for (const relativePath of [
	'libraries/nestjs-libraries/src/database/prisma/schema.prisma',
	'node_modules/.prisma',
	'node_modules/@prisma',
	'node_modules/prisma',
	'node_modules/@temporalio',
	'node_modules/bcrypt',
	'node_modules/canvas',
	'node_modules/sharp',
	'node_modules/@img',
	'node_modules/@sentry-internal'
]) {
	await copyRelative(relativePath)
}

if (!skipFrontend) {
	const standaloneRoot = 'apps/frontend/.next/standalone'
	const standaloneServer = `${standaloneRoot}/apps/frontend/server.js`
	try {
		await lstat(sourcePath(standaloneServer))
	} catch {
		throw new Error(`Next standalone server was not produced at ${standaloneServer}`)
	}

	await copyRelative(standaloneRoot)
	await copyTree(
		sourcePath('apps/frontend/.next/static'),
		path.join(outputDirectory, standaloneRoot, 'apps/frontend/.next/static')
	)
	await copyTree(
		sourcePath('apps/frontend/public'),
		path.join(outputDirectory, standaloneRoot, 'apps/frontend/public')
	)
}

console.log(
	`Prepared runtime artifact from ${fileList.size} traced files (${warnings.size} optional trace warnings).`
)
