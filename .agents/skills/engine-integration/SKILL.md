---
name: engine-integration
description: Integrar Kernel plugins capabilities input tick de física world e renderer sem criar loops paralelos.
---

# Integração dos subsistemas da engine

Use somente em issues de **integração entre subsistemas** ou bootstrap do host de jogo.

1. Localize `src/app/bootstrap.ts`, `src/app/createEnginePlugins.ts`, contratos/tokens de cada módulo e testes end-to-end existentes. Leia o código real antes de concluir que uma conexão existe.
2. Identifique owners de capabilities, dependências, ordem de setup/boot, emissão de eventos e teardown do Kernel. Nunca crie outro lifecycle, loop ou event bus.
3. Prove a ordem input → lógica no tick fixo → Rapier → world → render com interpolação. O input possui agendamento próprio na base atual: **não presuma sincronização**, demonstre-a por teste.
4. Faça a menor mudança possível em composition roots, ports ou adapters; sem imports cruzados `internal` ou dependência de DOM/Three/Rapier no Domain.
5. Inclua casos de falha: recurso ausente, focus/blur, Rapier init, rejection de IPC, Tauri/Steam offline conforme escopo.
6. Exercite boot, pause/resume, dispose e restart quando suportados; remova listeners, RAF, física, GPU, worker e timers adquiridos.
7. Execute testes focados e, quando ticket exige desktop, smoke Tauri nativo; registre limitações e evidência no Workpad Linear.
