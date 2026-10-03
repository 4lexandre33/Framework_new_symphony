@echo off
TITLE Script de Teste e Execucao do Ambiente Steam - Projeto 1

echo ============================================================
echo  1. LIMPANDO PROCESSOS PENDENTES NA PORTA 1420
echo ============================================================

for /f "tokens=5" %%a in ('netstat -aon ^| findstr :1420') do (
    echo Encerrando processo PID: %%a que esta travando a porta 1420...
    taskkill /F /PID %%a >nul 2>&1
)

taskkill /F /IM node.exe >nul 2>&1
taskkill /F /IM projeto1.exe >nul 2>&1

echo.
echo ============================================================
echo  2. EXECUTANDO AUDITORIA DE INVARIANTES E GUARDRAILS
echo ============================================================

node agents.mjs
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERRO CRITICO] A auditoria de invariantes falhou! Abortando inicializacao.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo  3. INICIANDO SERVIDOR DE DESENVOLVIMENTO TAURI (PORTA 1420)
echo ============================================================
echo.

npm run tauri dev