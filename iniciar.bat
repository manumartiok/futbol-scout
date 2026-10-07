@echo off
cd /d "%~dp0"
title Futbol Scout
start "" http://localhost:3000
node server.js
