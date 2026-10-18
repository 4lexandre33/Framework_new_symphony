## notas verificadas (comportamento)
- A engine chama `update(dt)` no tick (heurísticas de speedhack) e `recordFrame` no render. Não chame nenhum dos dois.
- Captura de erros AUTOMÁTICA (padrão ligada): `window` error/unhandledrejection e `kernel.handler.error` viram crash report (`source`) e `game.security.crash-generated`. Ouça esse evento para mostrar a tela de erro; `setCrashCaptureEnabled(false)` desliga.
- `dumpCrashReport(err, { activeSceneId?, source? })` sempre resolve: `written`/`path`/`writeError` dizem se gravou (só Tauri grava; limite padrão 10 dumps por sessão). A cena vem do `game.world`.
- Profiler: `beginSubsystemMetric(nome)`/`endSubsystemMetric(nome)` em volta dos sistemas do jogo; `getProfilerSnapshot(n)` dá FPS/tempos REAIS em janela móvel; `resetProfiler()`.
- Valores protegidos: `protectNumber(id, v)` (id vazio/valor não finito lança) → descritor opaco; `readProtectedNumber` (null se adulterado), `verifyIntegrity`.
- Speedhack: detecção automática (`getSpeedhackStatus`, alerta `game.security.alert`). Checagem própria: `createClockValidator("meu-id").validate()` periódico (estado por chamador). Nada competitivo deve confiar só no cliente.
