import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

test('scaffold: root directory has clean PWA layout and no flutter artifacts', () => {
  assert.strictEqual(fs.existsSync('package.json'), true, 'package.json must exist');
  assert.strictEqual(fs.existsSync('.gitignore'), true, '.gitignore must exist');
  assert.strictEqual(fs.existsSync('pubspec.yaml'), false, 'pubspec.yaml must be removed');
  assert.strictEqual(fs.existsSync('lib'), false, 'lib/ must be removed');
  assert.strictEqual(fs.existsSync('android'), false, 'android/ must be removed');
  assert.strictEqual(fs.existsSync('ios'), false, 'ios/ must be removed');

  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.strictEqual(pkg.type, 'module');
  assert.ok(pkg.scripts?.test, 'test script must be defined');
});
