@echo off
REM Script batch pour démarrer/arrêter Bytebot sur Windows

if "%1"=="stop" (
    powershell -ExecutionPolicy Bypass -File "%~dp0bytebot.ps1" stop
) else (
    powershell -ExecutionPolicy Bypass -File "%~dp0bytebot.ps1" start
)