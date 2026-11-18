# Task: `tests/pointerlock.test.ts` has 4 failing tests at `b89fb55`

Logged 2026-11-18 by the size-extremes S1 session, as a separate task at the owner's request. Not part of the size work, and not started.

## Facts

- 4 tests fail (6 pass) on a clean `b89fb55` checkout. They also fail in the main checkout with the camera session's uncommitted `src/input/input.ts`.
- The file was added in `d0d557e` ("feat: rework 1"). The failing tests describe behaviour `src/input/input.ts` doesn't implement yet:

| Line | Test | Failure |
|---|---|---|
| 104 | a rejected promise reports failure even without a `pointerlockerror` event | `ev.error` 0, expected 1 ("Resume must be told the request failed") |
| 122 | a throwing or missing API reports failure and does not swallow every attack | 0, expected 1 |
| 133 | repeated Resume clicks share a pending request | 3 requests, expected 1 |
| 139 | cancelling a pending request releases a late grant without resuming | fails |

- `Input.capture()` (`src/input/input.ts` ~line 227) swallows a rejected `requestPointerLock()` promise and a thrown error ("refused: the next click retries"), and keeps no pending-request state. That matches all four failures.
- Effect: `npm test`, and so `npm run check`, exit non-zero on `main`, so `check` never reaches its production build. Sessions have to run `npm run build` on their own.

## Ownership

`src/input/input.ts` has uncommitted changes from the camera session. Fix this after that work is committed, or in that session. Decide whether the tests or `input.ts` is right. The tests read as a spec written ahead of the code; see `docs/CONTROLS.md` for pointer lock.
