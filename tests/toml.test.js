import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parse, stringify, TomlError } from '../src/toml.mjs';

describe('values', () => {
  it('parses strings, numbers, bools, arrays', () => {
    const d = parse('s = "a\\n\\"q\\""\nl = \'raw\\n\'\ni = 1_000\nf = 3.5\nh = 0xFF\nb = true\narr = [1, 2,\n 3,]\nt = { a = 1, b = "x" }\n');
    assert.equal(d.s, 'a\n"q"');
    assert.equal(d.l, 'raw\\n');
    assert.equal(d.i, 1000);
    assert.equal(d.f, 3.5);
    assert.equal(d.h, 255);
    assert.equal(d.b, true);
    assert.deepEqual(d.arr, [1, 2, 3]);
    assert.deepEqual(d.t, { a: 1, b: 'x' });
  });
  it('rejects datetimes, mixed arrays and bad values', () => {
    assert.throws(() => parse('d = 1979-05-27'), (e) => e.code === 'UNSUPPORTED_DATETIME');
    assert.throws(() => parse('a = [1, "x"]'), (e) => e.code === 'MIXED_ARRAY');
    assert.throws(() => parse('a = '), (e) => e.code === 'BAD_VALUE');
    assert.throws(() => parse('a = "\\q"'), (e) => e.code === 'BAD_ESCAPE');
  });
});

describe('tables', () => {
  it('handles nesting, dotted keys and array tables', () => {
    const d = parse('[a.b]\nx = 1\n[[items]]\nn = "one"\n[[items]]\nn = "two"\n');
    assert.deepEqual(d, { a: { b: { x: 1 } }, items: [{ n: 'one' }, { n: 'two' }] });
  });
  it('rejects duplicates and bad shapes', () => {
    assert.throws(() => parse('a = 1\na = 2'), (e) => e.code === 'DUP_KEY');
    assert.throws(() => parse('[t]\n[t]'), (e) => e.code === 'DUP_TABLE');
    assert.throws(() => parse('[unclosed'), (e) => e.code === 'BAD_LINE');
    assert.ok(new TomlError('X') instanceof Error);
  });
  it('round-trips canonical documents', () => {
    const doc = parse('[server]\nhost = "example.com"\nports = [80, 443]\n[server.tls]\nenabled = true\n');
    assert.deepEqual(parse(stringify(doc)), doc);
    assert.deepEqual(parse(stringify(parse('a = 1\n'))), { a: 1 });
  });
});
