@echo off
cd /d "%~dp0"
if not exist .env (
  echo Falta el archivo .env. Copia .env.example como .env y pega tu clave de ElevenLabs.
  pause
  exit /b 1
)
start "" http://localhost:3000
node server.mjs
pause
