#!/usr/bin/env node
// Demo: parse and re-serialize, asserts fixed point. --assert exits non-zero on mismatch.
import { parse, stringify } from '../src/toml.mjs';

const INPUT = 'title = "Demo"\n\n[server]\nhost = "example.com"\nports = [80, 443]\n';

let failed = 0;
try {
  const once = parse(INPUT);
  const twice = parse(stringify(once));
  const pass = JSON.stringify(once) === JSON.stringify(twice) && once.server.ports.length === 2;
  console.log(`${pass ? 'PASS' : 'FAIL'} round-trip keys=${Object.keys(once).join(',')}`);
  if (!pass) failed++;
} catch (e) {
  failed++;
  console.log(`FAIL threw ${e.code}`);
}
if (process.argv.includes('--assert') && failed > 0) process.exit(1);
if (failed > 0) process.exitCode = 1;
console.log(failed === 0 ? 'demo: all cases as expected' : `demo: ${failed} mismatch(es)`);
