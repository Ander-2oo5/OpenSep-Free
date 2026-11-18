Option Explicit
Dim shell, fso, root, nodeExe, launcher, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
nodeExe = fso.BuildPath(root, "runtime\node\node.exe")
launcher = fso.BuildPath(root, "scripts\launcher.mjs")
If fso.FileExists(nodeExe) Then
  command = Chr(34) & nodeExe & Chr(34) & " " & Chr(34) & launcher & Chr(34) & " --shutdown"
  shell.Run command, 0, True
End If

