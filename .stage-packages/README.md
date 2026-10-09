# Stage 88 GitHub-direct certification packages

These small base64-encoded ZIP bootstrap payloads are inputs for `.github/workflows/stage88-production.yml`.
They materialize the missing Stage 86/87 governance on the remote branch and the Stage 88
production-readiness gate without overwriting `src-tauri/Cargo.toml`.

The workflow certifies Stage 88 on `windows-latest` with Rust `1.97.0` stable because Rust
1.99.0 reproduced internal compiler crashes in an isolated minimal crate and Rust 1.98.1
produced a separate compiler ICE during the local investigation.
