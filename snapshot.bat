@echo off
title Gerador de Snapshot - Projeto1_c2
cd /d "%~dp0"

echo ============================================================
echo Executando Gerador de Snapshot para o Projeto1_c2...
echo ============================================================
echo.

node snapshot.mjs %*

echo.
echo ============================================================
echo Processo finalizado.
echo ============================================================
pause