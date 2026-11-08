# Contract — toml-subset-core

Pure ESM in `src/toml.mjs`, zero runtime dependencies, Node >= 22.
TOML v1.0 essentials: bare/quoted keys, dotted keys, `[table]`,
`[[array-table]]`, basic + literal (+multiline) strings, integers
(dec/hex/oct/bin with `_`), floats (`inf`/`nan` included as values),
booleans, arrays (multiline, trailing commas), inline tables.

| Export | Result |
| --- | --- |
| `MAX_CHARS` (1M) · `MAX_DEPTH` (32) | Hard bounds. |
| `parse(text)` | Frozen nested object. Duplicate keys/tables fail; dotted keys create implicit tables that explicit sections may not reclaim. |
| `stringify(doc)` | Canonical TOML; `parse(stringify(parse(x)))` is a fixed point. |

Deliberate subset: datetimes rejected (`UNSUPPORTED_DATETIME`),
heterogeneous arrays rejected (`MIXED_ARRAY`), no `move`-style edits.
Multiline strings join `\\\n`-continuations per spec.

Errors: `NOT_STRING` · `TOO_BIG` · `TOO_MANY_LINES` · `BAD_LINE` ·
`BAD_SECTION` · `BAD_KEY` · `BAD_VALUE` · `BAD_STRING` · `BAD_ESCAPE` ·
`UNTERMINATED_STRING` · `BAD_BRACKET` · `TRAILING` · `DUP_KEY` ·
`DUP_TABLE` · `MIXED_ARRAY` · `UNSUPPORTED_DATETIME` · `BAD_NUMBER` ·
`BIG_INT` · `BAD_BASE` · `BAD_INLINE_DOT` · `BAD_DOC`.
