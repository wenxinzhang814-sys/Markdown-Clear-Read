@echo off
setlocal
set "APPDIR=%~dp0"
set "VBS=%APPDIR%open-markdown.vbs"
reg add "HKCU\Software\Classes\QingYueMarkdown" /ve /d "QingYue Markdown Document" /f >nul
reg add "HKCU\Software\Classes\QingYueMarkdown\DefaultIcon" /ve /d "%SystemRoot%\System32\shell32.dll,70" /f >nul
reg add "HKCU\Software\Classes\QingYueMarkdown\shell\open\command" /ve /d "wscript.exe \"%VBS%\" \"%%1\"" /f >nul
reg add "HKCU\Software\Classes\.md" /ve /d "QingYueMarkdown" /f >nul
reg add "HKCU\Software\Classes\.markdown" /ve /d "QingYueMarkdown" /f >nul
echo Markdown file association installed.
