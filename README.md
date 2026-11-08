# toml-subset-core

TOML v1.0 subset parser and canonical serializer: tables, dotted keys,
arrays, inline tables. Zero runtime dependencies, Node >= 22.

Part of the LOFRANO TECNOLOGIA open-source lab. MIT.

```js
import { parse } from './src/toml.mjs';
parse('[server]\nhost = "example.com"'); // { server: { host: 'example.com' } }
```

```sh
npm test          # 5 tests, node:test, no dependencies
npm run demo
```

No datetimes (rejected loudly); arrays must be homogeneous. MIT — see
`LICENSE`. [Versão em português](README.pt-BR.md).
