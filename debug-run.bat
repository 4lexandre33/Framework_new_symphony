@echo off
title Sistema de Debug e Execucao - Projeto1
cd /d "%~dp0"

echo ============================================================
echo   1. Coletando Diagnosticos de Ambiente...
echo ============================================================
echo.

node scripts/debug-diagnostics.mjs

echo.
echo ============================================================
echo   2. Executando Tauri Dev com Logs de Tracing do Rust...
echo ============================================================
echo Os logs detalhados estao sendo gravados em 'debug-execution.log'.
echo.

set RUST_BACKTRACE=1
set RUST_LOG=debug
set TAURI_DEBUG=true

call npx tauri dev > debug-execution.log 2>&1

if "%ERRORLEVEL%" NEQ "0" (
    echo.
    echo [FALHA DE EXECUCAO DETECTADA]
    echo A execucao encerrou com erro.
    echo Verifique o arquivo 'debug-execution.log' ou 'debug-report.txt' na pasta do projeto.
) else (
    echo.
    echo [SUCESSO] Aplicacao encerrada normalmente.
)

pause