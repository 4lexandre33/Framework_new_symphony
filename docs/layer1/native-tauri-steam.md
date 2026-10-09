# Layer 1 — Host nativo Tauri/Rust e Steam

Resume o que foi certificado nas Stages 84, 85 e 88. O host nativo vive em
`src-tauri/`.

## 1. Fronteira de segurança

A comunicação WebView → Rust é uma **fronteira não confiável**. Todo comando
precisa de payload validado, mínimo privilégio, erro serializável/mapeado e API
TypeScript tipada. Não há shell arbitrário nem escape de caminho.

Os comandos registrados em `src-tauri/src/lib.rs` (`generate_handler!`) somam
**37**, por área:

| Área | Qtde | Arquivo |
|---|---|---|
| Steam (runtime, usuário, achievements, stats, lobby, P2P, cloud, overlay, workshop) | 24 | `src-tauri/src/steam.rs` |
| Overlay (janela, cursor, always-on-top, taskbar) | 4 | `src-tauri/src/overlay.rs` |
| Security (relógio do sistema, crash dump) | 2 | `src-tauri/src/security.rs` |
| Modding | 3 | `src-tauri/src/modding.rs` |
| Monetization | 4 | `src-tauri/src/monetization.rs` |

A Stage 85 adicionou auditoria executável (`scripts/architecture/lib/layer1-native-tauri-v1.mjs`) que exige
paridade entre `#[tauri::command]`, `generate_handler!` e os `invoke()` do
TypeScript, e proíbe `invoke<any>` e invoke dinâmico. Além disso:

- o input do boundary de Modding é validado (limites, traversal, canonicalização, manifesto);
- a Monetization opera em modo *fail-closed*, sem sucesso, SteamID ou segredo sintéticos;
- a API global do Tauri está desabilitada (`withGlobalTauri: false`); o boundary é o import ESM;
- a CSP explícita vale somente em produção; `devCsp` permanece `null` para não quebrar Vite/Tauri dev;
- a capability default fica limitada à janela `main`, sem wildcard, shell ou fs.

Referência: `ETAPA85_NATIVE_TAURI_INFRASTRUCTURE.txt`.

## 2. Configuração de produção

Definida em `src-tauri/tauri.conf.json` e certificada na Stage 88:

| Item | Valor |
|---|---|
| `productName` / `identifier` | `projeto1` / `com.projeto1.game` |
| Versão (package, Tauri e Cargo) | `0.1.0`, coerente nos três |
| `frontendDist` | `../dist` |
| `beforeBuildCommand` | `npm run build` |
| `devUrl` | `http://localhost:1420` |
| Janela | 1280x720, redimensionável, transparente, sem decoração e *always on top* (configuração intencional existente) |
| Bundle | ativo, ícones existentes |

Em release, `windows_subsystem = "windows"` vale somente para o build de release.
O DPR é limitado e o listener de resize é removível; `blur`, visibilidade e
pointer lock limpam o estado de input.

## 3. Steam é um adapter opcional

- A feature Cargo `steam` está em `default` no `src-tauri/Cargo.toml`, de forma explícita.
- O `SteamState` inicializa **uma vez** no host e encerra em `RunEvent::Exit`
  (stop + join + Drop), sem thread residual.
- Sem Steam disponível o app não cai: registra a indisponibilidade e segue em
  **modo offline controlado**.
- `src-tauri/steam_appid.txt` contém o AppID `480` e é um contrato **somente de
  desenvolvimento**; esse arquivo não entra nos `resources` do bundle.
- O Steam não é dono de gameplay e não pode vazar para o Domain.

**Observação de execução (Linux).** Em uma execução local do release Linux
feita na Stage 89, o binário **não carregou** sem `libsteam_api.so` no
`LD_LIBRARY_PATH`. A biblioteca é produzida pelo build em
`src-tauri/target/release/build/steamworks-sys-*/out/`. Com ela disponível e sem
cliente Steam rodando, o app registrou "Steam indisponível" e seguiu offline. A
distribuição Linux precisa, portanto, levar essa biblioteca junto ou resolvê-la
pelo ambiente do Steam. Esse caminho **não é coberto pelo CI**, que só compila.

Referências: `ETAPA84_STEAMWORKS_INTEGRATION.txt`,
`ETAPA88_DESKTOP_STEAM_PRODUCTION_READINESS.txt`.

## 4. Pré-requisitos de build

- **Windows:** dependências padrão do Tauri 2 para Windows.
- **Linux (Ubuntu 24.04, verificado):** `build-essential`, `pkg-config`,
  `libwebkit2gtk-4.1-dev`, `libxdo-dev`, `libssl-dev`,
  `libayatana-appindicator3-dev` e `librsvg2-dev`. Sem elas o `cargo check`
  falha em `gdk-sys` por não achar `gdk-3.0`.
- Rust **1.97.0** é o toolchain da certificação oficial.

## 5. Release e empacotamento

| Alvo | Como é gerado | Evidência |
|---|---|---|
| Linux (sem bundle) | `tests/run-stage88-release-smoke.mjs` — `tauri build --no-bundle` com `src-tauri/tauri.stage88.conf.json` | `ETAPA88_RELEASE_SMOKE_EVIDENCE.json` |
| Windows (NSIS) | `tests/run-stage88-windows-package-smoke.mjs` — `tauri build --bundles nsis` | `ETAPA88_WINDOWS_PACKAGE_EVIDENCE.json` |

O Tauri CLI normaliza `src-tauri/Cargo.toml` durante o build. Os smokes salvam os
bytes originais, restauram o arquivo byte a byte depois e registram
`cargoManifestMutatedByTauri` e `cargoManifestRestored`. O `src-tauri/Cargo.toml` não pode
permanecer alterado após a certificação.

A autoridade da certificação é o workflow `.github/workflows/stage88-production.yml`:
Linux e Windows certificam o **mesmo** `github.sha`; a evidência Linux passa ao
runner Windows por artifact do Actions, e somente o job Windows final publica o
commit de certificação. Runs obsoletos são cancelados (`cancel-in-progress`).

O release foi compilado e o executável foi gerado nas duas plataformas, mas o CI
não executa o `.exe` nem o binário Linux. A execução real do app deve ser
verificada na máquina de destino.
