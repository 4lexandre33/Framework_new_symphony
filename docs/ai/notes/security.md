## notas verificadas (comportamento)
- A engine chama `update(dt)` no tick.
- `protectNumber`/`readProtectedNumber`/`verifyIntegrity` são puros (em memória). `protectNumber` lança com id vazio ou valor não finito.
- `dumpCrashReport(err)` resolve com o relatório e emite `game.security.crash-generated` mesmo sem Tauri.
- NÃO há captura automática de erros: o jogo registra `window.addEventListener("error"/"unhandledrejection")` num adapter e chama `dumpCrashReport` (remova no dispose).
- Profiler: `beginSubsystemMetric(nome)`/`endSubsystemMetric(nome)` em volta de cada sistema do jogo; leia `getProfilerSnapshot()`.
