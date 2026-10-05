# vendor/

Local copies of the three CDN scripts `index.html` loads, used only by the
Playwright tests in `tests/` (the sandbox the tests run in cannot reach
`cdn.jsdelivr.net`; tests intercept those requests and serve these files
instead — see `tests/fixtures/mockGoogle.js`). The live page still loads
from jsDelivr with Subresource Integrity; these are not referenced by
`index.html` itself.

| File | Package | Matches the `integrity` pinned in `index.html` |
|---|---|---|
| `exceljs.min.js` | `exceljs@4.4.0` (`dist/exceljs.min.js`) | `sha384-Pqp51FUN2/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf+arZvACkLkirlPz` |
| `qrcode.js` | `qrcode-generator@1.4.4` (`qrcode.js`) | `sha384-8FWZA6BGMXhsfO+BLtrJK0We6gg5o1JyO8xQm6peWDEUs17ACA5ziE/NIAkl9z2k` |
| `purify.min.js` | `dompurify@3.4.16` (`dist/purify.min.js`) | `sha384-a7SzOxErzJ3ZpQz0zJ32d67dSitNzPcbfybc/ykU9KJhMgZkwqfSxlhhdJRS+XGL` |

Downloaded from the npm registry (`registry.npmjs.org`, reachable even where
`cdn.jsdelivr.net` is blocked) and verified with:

```bash
openssl dgst -sha384 -binary vendor/exceljs.min.js | openssl base64 -A
openssl dgst -sha384 -binary vendor/qrcode.js      | openssl base64 -A
openssl dgst -sha384 -binary vendor/purify.min.js  | openssl base64 -A
```

Each matches the `integrity` attribute in `index.html` exactly — jsDelivr's
npm CDN serves package files byte-for-byte as published, so the npm tarball
and the CDN response are the same bytes. Re-run the three commands above
whenever a version pinned in `index.html` changes.
