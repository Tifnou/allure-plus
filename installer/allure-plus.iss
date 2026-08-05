#define MyAppName "Allure+"
#define MyAppVersion "1.4.0"
#define MyAppPublisher "Allure+"

[Setup]
AppId={{5AF031A6-0300-4E16-AF65-F9F55E8E9B17}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=no
OutputDir=Output
OutputBaseFilename=AllurePlus_Setup_v{#MyAppVersion}
SetupIconFile=..\logo-allure.ico
UninstallDisplayIcon={app}\logo-allure.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\French.isl"

[Files]
Source: "..\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion; Excludes: "\node_modules,\node_modules\*,\.git,\.git\*,\.claude,\.claude\*,\installer,\installer\*,\.env,\.campus_token,\.garmin_tokens,\.garmin_tokens\*,\cache.json,\imported_plan.json,\*.log,\Allure+.lnk,\uploads,\uploads\*,\Images,\Images\*,\data,\data\*"
; Photos de fond : ne sont copiees que si le dossier n'existe pas encore ou est
; vide (installation neuve). Sur une mise a jour, on ne touche jamais aux photos
; de l'utilisateur (par defaut ou personnalisees) - voir ShouldSeedImages ci-dessous.
Source: "..\Images\*"; DestDir: "{app}\Images"; Flags: recursesubdirs createallsubdirs ignoreversion; Excludes: "\thumbs,\thumbs\*"; Check: ShouldSeedImages

[Icons]
Name: "{group}\Allure+"; Filename: "{app}\start.bat"; WorkingDir: "{app}"; IconFilename: "{app}\logo-allure.ico"
Name: "{group}\Arreter Allure+"; Filename: "{app}\stop_serveur.bat"; WorkingDir: "{app}"; IconFilename: "{app}\logo-allure.ico"
Name: "{group}\Desinstaller Allure+"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\install.bat"; WorkingDir: "{app}"; Flags: waituntilterminated; Description: "Installer Node.js et les dependances d'Allure+"

[Code]
function ShouldSeedImages(): Boolean;
var
  ImagesDir: String;
  FindRec: TFindRec;
  HasContent: Boolean;
begin
  ImagesDir := ExpandConstant('{app}\Images');
  if not DirExists(ImagesDir) then
  begin
    Result := True;
    Exit;
  end;
  HasContent := False;
  if FindFirst(ImagesDir + '\*', FindRec) then
  begin
    try
      repeat
        if (FindRec.Name <> '.') and (FindRec.Name <> '..') and (FindRec.Name <> 'thumbs') then
          HasContent := True;
      until (not FindNext(FindRec)) or HasContent;
    finally
      FindClose(FindRec);
    end;
  end;
  Result := not HasContent;
end;
