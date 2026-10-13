@echo off
rem Starts MKWii Advanced Editor from source (requires Bun: https://bun.sh)
cd /d "%~dp0"
if not exist node_modules call bun install
bun start %*
