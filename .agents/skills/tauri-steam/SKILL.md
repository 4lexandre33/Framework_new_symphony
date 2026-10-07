---
name: tauri-steam
description: Implementar e verificar fronteiras Tauri v2 Rust TypeScript e o adapter Steamworks em Ubuntu desktop com permissões mínimas.
---

# Desktop Tauri / Rust / Steam

Use em issues que alterem `src-tauri/**`, comandos IPC, capabilities, distribuição desktop ou integrações Steamworks.

1. Localize o comando Rust e seu wrapper TypeScript antes de editar; preserve a tipagem da ponte WebView ↔ Rust.
2. Valide entradas não confiáveis, caminhos e permissões. Não libere comandos shell genéricos, broad filesystem access ou secrets no front-end.
3. Implemente erros mapeáveis e cleanup determinístico na inicialização/saída.
4. Confirme se o recurso Steam é opcional e como as features de Cargo mudam a compilação.
5. Execute `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` e `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` quando o ambiente suportar o SDK, além de `cargo check --manifest-path src-tauri/Cargo.toml`.
6. Quando Steam SDK nativo não estiver disponível, um `cargo check --no-default-features --manifest-path src-tauri/Cargo.toml` é somente evidência parcial e deve ser rotulado como tal.
7. Valide smoke desktop Tauri quando executável e relevante. Registre impossibilidades no Linear em vez de declarar PASS fictício.
