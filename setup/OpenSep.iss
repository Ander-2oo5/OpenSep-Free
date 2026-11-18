#define AppName "OpenSep"
#define AppVersion "1.0.0"
#define AppPublisher "OpenSep"
#define AppURL "https://github.com/"

[Setup]
AppId={{A107CE7A-4E47-4B54-8D1E-4E13A0950BC2}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
DefaultDirName={localappdata}\Programs\OpenSep
DefaultGroupName=OpenSep
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir=..\dist-installer
OutputBaseFilename=OpenSep-Setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
UninstallDisplayName=OpenSep
ExtraDiskSpaceRequired=16106127360
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "desktopicon"; Description: "Crear un acceso directo en el escritorio"; GroupDescription: "Accesos directos:"; Flags: checkedonce

[Files]
Source: "..\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\pnpm-lock.yaml"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\pnpm-workspace.yaml"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\apps\api\package.json"; DestDir: "{app}\apps\api"; Flags: ignoreversion
Source: "..\apps\api\src\*"; DestDir: "{app}\apps\api\src"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\apps\runner\package.json"; DestDir: "{app}\apps\runner"; Flags: ignoreversion
Source: "..\apps\runner\src\*"; DestDir: "{app}\apps\runner\src"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\apps\web\dist\*"; DestDir: "{app}\apps\web\dist"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\packages\contracts\package.json"; DestDir: "{app}\packages\contracts"; Flags: ignoreversion
Source: "..\packages\contracts\src\*"; DestDir: "{app}\packages\contracts\src"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\packages\server-core\package.json"; DestDir: "{app}\packages\server-core"; Flags: ignoreversion
Source: "..\packages\server-core\src\*"; DestDir: "{app}\packages\server-core\src"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\worker\*.py"; DestDir: "{app}\worker"; Flags: ignoreversion
Source: "..\worker\requirements.txt"; DestDir: "{app}\worker"; Flags: ignoreversion
Source: "..\worker\opensep_worker\*.py"; DestDir: "{app}\worker\opensep_worker"; Flags: ignoreversion
Source: "..\scripts\install-runtime.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "..\scripts\launcher.mjs"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "..\scripts\OpenSep.vbs"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "..\scripts\Stop-OpenSep.vbs"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "assets\node\*"; DestDir: "{app}\runtime\node"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "assets\ffmpeg\ffmpeg.exe"; DestDir: "{app}\runtime\ffmpeg"; Flags: ignoreversion
Source: "assets\ffmpeg\ffprobe.exe"; DestDir: "{app}\runtime\ffmpeg"; Flags: ignoreversion
Source: "assets\ffmpeg\LICENSE.txt"; DestDir: "{app}\runtime\ffmpeg"; Flags: ignoreversion
Source: "assets\python\python-3.11.9-amd64.exe"; DestDir: "{app}\setup-assets"; Flags: ignoreversion

[Icons]
Name: "{group}\OpenSep"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\scripts\OpenSep.vbs"""; WorkingDir: "{app}"
Name: "{group}\Detener OpenSep"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\scripts\Stop-OpenSep.vbs"""; WorkingDir: "{app}"
Name: "{autodesktop}\OpenSep"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\scripts\OpenSep.vbs"""; WorkingDir: "{app}"; Tasks: desktopicon

[UninstallRun]
Filename: "{app}\runtime\node\node.exe"; Parameters: """{app}\scripts\launcher.mjs"" --shutdown"; Flags: runhidden waituntilterminated skipifdoesntexist; RunOnceId: "StopOpenSep"
Filename: "{app}\setup-assets\python-3.11.9-amd64.exe"; Parameters: "/uninstall /quiet TargetDir=""{app}\runtime\python"""; Flags: runhidden waituntilterminated skipifdoesntexist; RunOnceId: "RemovePrivatePython"

[UninstallDelete]
Type: filesandordirs; Name: "{localappdata}\OpenSep\models"
Type: filesandordirs; Name: "{localappdata}\OpenSep\pnpm-store"
Type: filesandordirs; Name: "{localappdata}\OpenSep\corepack"
Type: filesandordirs; Name: "{localappdata}\OpenSep\InstallerCache"
Type: filesandordirs; Name: "{localappdata}\OpenSep\state"

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\scripts\OpenSep.vbs"""; Description: "Abrir OpenSep"; Flags: postinstall nowait skipifsilent

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  Parameters: String;
begin
  if CurStep = ssPostInstall then
  begin
    WizardForm.StatusLabel.Caption := 'Instalando dependencias y modelos de OpenSep...';
    Parameters := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\scripts\install-runtime.ps1') + '" -InstallRoot "' + ExpandConstant('{app}') + '"';
    if (not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Parameters, ExpandConstant('{app}'), SW_SHOW, ewWaitUntilTerminated, ResultCode)) or (ResultCode <> 0) then
    begin
      MsgBox(
        'No se pudo completar la instalación de OpenSep.' + #13#10 +
        'Código: ' + IntToStr(ResultCode) + #13#10 +
        'Registro: ' + ExpandConstant('{localappdata}\OpenSep\logs'),
        mbError,
        MB_OK
      );
      RaiseException('La instalación de dependencias terminó con error.');
    end;
  end;
end;

