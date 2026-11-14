Fixture for the isolated model-fix verifier tests (`tests/modelfix-verify.test.ts`).
The page has three known issues: low text contrast (`#note`), a progress bar with
no accessible name (`#upload`) and an image without alt text (`#hero`).
Tests copy it into a temporary git repository; it is never served publicly.
