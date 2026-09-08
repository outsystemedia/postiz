// Compile only this branch's changed runtime files over the matching base image.
// For staging validation; production must use the repository's full Docker build.
const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const output = path.join(__dirname, 'patch');
const changed = cp
  .execFileSync(
    'git',
    ['diff', '--name-only', 'd48e9556', '--', 'apps', 'libraries'],
    { cwd: root, encoding: 'utf8' }
  )
  .trim()
  .split('\n');
const newFiles = cp
  .execFileSync(
    'git',
    ['ls-files', '--others', '--exclude-standard', 'apps', 'libraries'],
    { cwd: root, encoding: 'utf8' }
  )
  .trim()
  .split('\n');
const aliases = {
  '@gitroom/backend/': 'apps/backend/src/',
  '@gitroom/nestjs-libraries/': 'libraries/nestjs-libraries/src/',
  '@gitroom/helpers/': 'libraries/helpers/src/',
  '@gitroom/react/': 'libraries/react-shared-libraries/src/',
};
for (const file of new Set([...changed, ...newFiles])) {
  if (!file.endsWith('.ts') || /\.(?:spec|test)\.ts$/.test(file)) continue;
  const compiled = ts.transpileModule(
    fs.readFileSync(path.join(root, file), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
        esModuleInterop: true,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        importHelpers: true,
      },
    }
  ).outputText;
  const code = compiled.replace(
    /require\("(@gitroom\/[^\"]+)"\)/g,
    (match, name) => {
      const prefix = Object.keys(aliases).find((prefix) =>
        name.startsWith(prefix)
      );
      if (!prefix) throw new Error('Unresolved alias: ' + name);
      let relative = path.relative(
        path.dirname(file),
        aliases[prefix] + name.slice(prefix.length)
      );
      if (!relative.startsWith('.')) relative = './' + relative;
      return `require(${JSON.stringify(relative)})`;
    }
  );
  for (const app of ['backend', 'orchestrator']) {
    const destination = path.join(
      output,
      'apps',
      app,
      'dist',
      file.replace(/\.ts$/, '.js')
    );
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, code);
  }
}
console.log('Staging runtime patch compiled.');
