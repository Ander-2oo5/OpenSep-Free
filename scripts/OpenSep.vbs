Option Explicit
Dim shell, fso, root, nodeExe, launcher, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
nodeExe = fso.BuildPath(root, "runtime\node\node.exe")
launcher = fso.BuildPath(root, "scripts\launcher.mjs")
If Not fso.FileExists(nodeExe) Then
  MsgBox "OpenSep no está instalado correctamente. Ejecuta OpenSep-Setup.exe para reparar la instalación.", 16, "OpenSep"
  WScript.Quit 1
End If
command = Chr(34) & nodeExe & Chr(34) & " " & Chr(34) & launcher & Chr(34)
shell.Run command, 0, False

