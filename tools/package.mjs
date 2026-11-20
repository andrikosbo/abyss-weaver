import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.resolve(process.argv[2] ?? path.join(root, 'artifacts'));
const { name, version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

fs.mkdirSync(output, { recursive: true });
const stage = fs.mkdtempSync(path.join(output, '.abyss-release-'));
try {
  execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
  assert.deepEqual(fs.readFileSync(path.join(root, 'LICENSE')), fs.readFileSync(path.join(root, 'dist/licenses/Abyss-Weaver-MIT.txt')));
  const source = path.join(stage, name);
  const files = fs.readFileSync(path.join(root, 'tools/release-files.txt'), 'utf8').trim().split(/\r?\n/);
  for (const file of files) {
    const origin = path.join(root, file);
    const destination = path.join(source, file);
    assert.ok(fs.lstatSync(origin).isFile(), file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(origin, destination);
  }

  const sourceZip = `${name}-${version}-source.zip`;
  const buildZip = `${name}-${version}-static.zip`;
  execFileSync('zip', ['-q', '-X', '-r', path.join(stage, sourceZip), name], { cwd: stage });
  execFileSync('zip', ['-q', '-X', '-r', path.join(stage, buildZip), '.'], { cwd: path.join(root, 'dist') });
  for (const file of [sourceZip, buildZip]) {
    fs.renameSync(path.join(stage, file), path.join(output, file));
    console.log(path.join(output, file));
  }
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
