Projeto1_055 - Correção Rust RECT / Windows API

Correção:
- RECT pertence a windows_sys::Win32::Foundation::RECT.
- FindWindowW e GetWindowRect permanecem em Win32::UI::WindowsAndMessaging.
- O Cargo.toml do patch anterior já habilita Win32_Foundation e Win32_UI_WindowsAndMessaging.

Extração na raiz do projeto:
unzip -o projeto1_055_overlay_rect_fix.zip -d .

Validação:
cargo check --manifest-path src-tauri/Cargo.toml
npx tsc --noEmit
npx vitest run tests/overlay-system.test.ts tests/streaming-system.test.ts tests/security-system.test.ts
npm run build
