@echo off
cd /d "%~dp0"
if not exist .env (
  copy .env.example .env >nul
  echo Se creo el archivo .env a partir de .env.example.
  echo Para activar la voz pega tu clave de ElevenLabs en .env ^(ELEVENLABS_API_KEY^) y volve a abrir este archivo.
  echo.
)
node verificar.mjs
echo.
start "" http://localhost:3000
node server.mjs
pause
