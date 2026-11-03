Option Explicit
Dim shell, fso, app, filePath, base
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
If WScript.Arguments.Count > 0 Then filePath = WScript.Arguments(0) Else filePath = ""
app = base & "\reader.hta"
If filePath <> "" Then
  shell.Run "mshta.exe """ & app & "?" & Encode(filePath) & """", 1, False
Else
  shell.Run "mshta.exe """ & app & """", 1, False
End If
Function Encode(s)
  Encode = Replace(Replace(Replace(s, "%", "%25"), " ", "%20"), "#", "%23")
End Function
