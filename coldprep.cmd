@echo off
rem Windows launcher. Verify dist\SHA256SUMS yourself first: certutil -hashfile dist\dgb-coldprep.cjs SHA256
node "%~dp0dist\dgb-coldprep.cjs" %*
pause
