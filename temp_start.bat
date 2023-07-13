@echo off
cd %~dp0
node_modules\.bin\pm2.cmd start main.js
