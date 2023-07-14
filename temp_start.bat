@echo off
cd %~dp0
git pull
node_modules\.bin\pm2.cmd start main.js
