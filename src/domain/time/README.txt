PROJETO1 — CAMADA 2 / DOMAIN TIME

Path: src/domain/time
Camada arquitetural: Camada 2 — Domínio
Status: implementação real iniciada na Etapa 48.

FUNÇÃO
Representar tempo determinístico de simulação sem depender de relógio civil,
FPS, requestAnimationFrame, performance.now, Date.now ou GameLoop concreto.

PRINCÍPIO
Tempo de domínio é dado de entrada.

A camada superior decide como converter seu fixed tick/delta em:
- SimulationTick;
- DomainDuration.

src/domain/time apenas valida e manipula esses valores.

IMPLEMENTAÇÃO ATUAL

SimulationTick.ts
- inteiro seguro >= 0;
- runtime é number branded;
- createSimulationTick();
- addSimulationTicks();
- simulationTickToNumber();
- overflow explicitamente rejeitado.

DomainDuration.ts
- duração em ticks inteiros seguros >= 0;
- runtime é number branded;
- createDomainDuration();
- addDomainDurations();
- subtractDomainDurations();
- domainDurationToTicks();
- subtraction satura em 0;
- overflow explicitamente rejeitado.

TimerSnapshot.ts
Statuses:
- idle;
- running;
- paused;
- completed.

Snapshot:
- durationTicks;
- elapsedTicks;
- status.

SimulationTimer.ts
Lifecycle:
- idle -> running;
- running -> paused;
- paused -> running;
- running/paused -> completed;
- qualquer status -> reset() -> idle/running.

Operações:
- start();
- pause();
- resume();
- advance(elapsed);
- complete();
- reset(autoStart);
- toSnapshot();
- fromSnapshot().

advance()
- só consome tempo quando status == running;
- elapsed é fornecido externamente;
- satura exatamente em duration;
- muda para completed automaticamente;
- retorna quantidade efetivamente aplicada;
- não aloca snapshot/evento.

DETERMINISMO
Dois timers com o mesmo:
- duration;
- snapshot inicial;
- sequência de DomainDuration em advance();

produzem o mesmo resultado independentemente de FPS ou hardware.

TEMPO CIVIL VS TEMPO DE SIMULAÇÃO
ClockPort da fundação anterior serve a necessidades de wall-clock da aplicação,
como timestamp de save.

Domain Time serve a:
- cooldown;
- duração de status;
- timeout lógico;
- quest timer;
- sequência temporal;
- regras determinísticas.

ClockPort e Domain Time NÃO são a mesma abstração.

PERFORMANCE
- SimulationTick/DomainDuration são números branded: zero wrapper runtime;
- advance() muta elapsed/status in-place;
- pause/resume/start/reset são O(1);
- toSnapshot() é alocado somente sob demanda;
- nenhum array/Map é criado em advance().

DEPENDÊNCIAS PROIBIDAS
- Date.now()
- performance.now()
- requestAnimationFrame()
- setTimeout()/setInterval() como fonte de domínio
- src/engine/**
- src/services/**
- src/app/**
- src/plugins/**
- game.loop
- Three.js
- Babylon.js
- Rapier
- DOM
- Tauri
- Steamworks SDK

DIMENSIONALIDADE
Tempo de domínio é independente de representação espacial.
A implementação é idêntica para 2D, 2.5D, 3D e headless.

PRÓXIMA ETAPA
Etapa 49 — Domain Events.
