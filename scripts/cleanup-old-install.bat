@echo off
chcp 65001 >nul
sc stop Messenger >nul 2>&1
sc delete Messenger >nul 2>&1
takeown /f "C:\ProgramData\Messenger" /r /d y >nul 2>&1
icacls "C:\ProgramData\Messenger" /grant Administrators:F /t /q >nul 2>&1
rd /s /q "C:\ProgramData\Messenger" 2>&1
if exist "C:\ProgramData\Messenger" (echo ОШИБКА: C:\ProgramData\Messenger) else (echo OK: C:\ProgramData\Messenger удалён)
takeown /f "C:\Program Files\Messenger" /r /d y >nul 2>&1
icacls "C:\Program Files\Messenger" /grant Administrators:F /t /q >nul 2>&1
rd /s /q "C:\Program Files\Messenger" 2>&1
if exist "C:\Program Files\Messenger" (echo ОШИБКА: C:\Program Files\Messenger) else (echo OK: C:\Program Files\Messenger удалён)
netsh advfirewall firewall delete rule name="Messenger Server" >nul 2>&1
echo OK: файрволл
reg delete "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{F3A2B1C4-D5E6-7890-ABCD-EF0123456789}_is1" /f >nul 2>&1
reg delete "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{DE091103-B235-3793-80D6-2BF5F370E603}" /f >nul 2>&1
echo OK: реестр
echo Готово.
