# Install the A11yGate pilot CLI

Automated testing only. Not a WCAG audit, certification or legal advice.

Use the tarball and checksum file you received directly from Eliran. Place them in your project's root and verify the download before installing.

```sh
shasum -a 256 -c SHA256SUMS
```

```sh
npm install --save-dev ./{{archive}} playwright@{{playwright}} @axe-core/playwright
npx playwright install chromium
npx --no-install a11ygate doctor
```
