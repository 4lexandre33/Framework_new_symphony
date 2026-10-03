@echo off
title Validador do Ambiente Steamworks - Projeto1
cd /d "%~dp0"

echo ============================================================
echo   Diretorio do Projeto: %CD%
echo ============================================================
echo.

if not exist "tests" (
    mkdir tests
)

if not exist "package.json" (
    echo [ERRO CRITICO] package.json nao encontrado!
    echo Execute este script dentro da pasta do seu projeto.
    echo.
    pause
    exit /b 1
)

echo ============================================================
echo   1. Verificando dependencias do Node.js (node_modules)...
echo ============================================================
echo.

if not exist "node_modules" (
    echo [AVISO] A pasta node_modules nao foi encontrada.
    echo Instalando dependencias com 'npm install'...
    echo.
    call npm install
    if "%ERRORLEVEL%" NEQ "0" (
        echo [ERRO] Falha ao executar 'npm install'. Verifique sua conexao e tente novamente.
        pause
        exit /b 1
    )
) else (
    echo [OK] Pasta node_modules encontrada.
)

echo.
echo ============================================================
echo   2. Verificando ambiente Rust / Cargo...
echo ============================================================
echo.

where cargo >nul 2>nul
if "%ERRORLEVEL%" NEQ "0" (
    echo [ERRO CRITICO] O compilador Cargo/Rust nao foi encontrado no PATH.
    echo Instale o Rust atraves do site https://rustup.rs/ e reabra o terminal.
    echo.
    pause
    exit /b 1
) else (
    echo [OK] Compilador Rust detectado com sucesso.
)

echo.
echo ============================================================
echo   3. Verificando se o Cliente Steam.exe esta rodando...
echo ============================================================
echo.

tasklist /FI "IMAGENAME eq steam.exe" 2>NUL | findstr /I "steam.exe" >NUL
if "%ERRORLEVEL%"=="0" (
    echo [OK] O cliente Steam.exe esta em execucao na memoria.
) else (
    echo [AVISO] O cliente Steam NAO foi detectado.
    echo Abra a Steam se desejar testar o Overlay e Conquistas reais.
    echo.
)

echo ============================================================
echo   4. Coletando Diagnostico e Auditoria de Sanidade...
echo ============================================================
echo.

if exist "tests\debug-diagnostics.mjs" (
    node tests\debug-diagnostics.mjs
)

if exist "tests\steam-smoke-test.mjs" (
    node tests\steam-smoke-test.mjs
) else (
    echo [AVISO] Script tests\steam-smoke-test.mjs nao encontrado. Pulando auditoria...
)

echo.
echo ============================================================
echo   5. Executando Tauri Dev (Arquivando em tests\debug-execution.log)...
echo ============================================================
echo.

set RUST_BACKTRACE=1
set RUST_LOG=debug
set TAURI_DEBUG=true

call npx tauri dev > tests\debug-execution.log 2>&1

if "%ERRORLEVEL%" NEQ "0" (
    echo.
    echo [FALHA DE EXECUCAO DETECTADA]
    echo A execucao encerrou com erro.
    echo O log detalhado foi arquivado em 'tests\debug-execution.log'.
    echo O relatorio de diagnostico foi arquivado em 'tests\debug-report.txt'.
) else (
    echo.
    echo [SUCESSO] Aplicacao encerrada normalmente.
    echo O log da sessao foi salvo em 'tests\debug-execution.log'.
)

echo.
echo ============================================================
echo Processo finalizado. Todos os logs estao na pasta tests\
echo ============================================================
pause