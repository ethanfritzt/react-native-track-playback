# Contributing

## Async API policy

Public methods follow a deliberate async/sync split:

| Category | Return type | Rationale |
|---|---|---|
| Engine mutations (`play`, `pause`, `stop`, `seekTo`, …) | `Promise<void>` | Involve async native audio operations |
| Queue mutations (`add`, `remove`) | `void` | Synchronous in-memory operations; no async work |
| Query methods (`getQueue`, `getActiveTrack`, `getState`, `getPosition`, …) | Synchronous value | Pure reads; `Promise` wrapper adds noise with no benefit |

Do not add `async` to a method unless it contains at least one `await`.
