#define MyAppName "Allure+"
#define MyAppVersion "1.11.2"
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
; L'app tourne ensuite en utilisateur standard (non elevee) mais ecrit ses
; donnees (data\, uploads\, tokens, cache.json...) directement dans {app},
; qui est sous Program Files. Program Files refuse l'ecriture aux comptes
; standard par defaut -> EPERM des qu'un nouveau fichier doit y etre cree
; (constate en prod : EPERM sur data\session_analyses.json). On accorde donc
; explicitement Modify au groupe Users (SID S-1-5-32-545, insensible a la
; langue de l'OS) sur tout le dossier applicatif, une fois pour toutes.
Filename: "icacls"; Parameters: """{app}"" /grant *S-1-5-32-545:(OI)(CI)M /T /C"; Flags: runhidden waituntilterminated; StatusMsg: "Configuration des permissions..."
Filename: "{app}\install.bat"; WorkingDir: "{app}"; Flags: waituntilterminated; Description: "Installer Node.js et les dependances d'Allure+"

[Code]
var
  // ShouldSeedImages est appelee une fois PAR FICHIER par Inno Setup (le
  // Check: d'une entree [Files] a wildcard est reevalue a chaque fichier,
  // pas une seule fois pour tout le groupe). Sans cache, des que le premier
  // fichier (Sport1.jpg) est copie, {app}\Images n'est plus vide et le
  // Check renvoie False pour tous les suivants -> un seul fichier installe
  // au lieu des dix (bug constate en prod). On decide donc une seule fois,
  // avant toute copie, et on reutilise ce resultat pour tous les fichiers.
  ShouldSeedImagesChecked: Boolean;
  ShouldSeedImagesResult: Boolean;

function ShouldSeedImages(): Boolean;
var
  ImagesDir: String;
  FindRec: TFindRec;
  HasContent: Boolean;
begin
  if ShouldSeedImagesChecked then
  begin
    Result := ShouldSeedImagesResult;
    Exit;
  end;

  ImagesDir := ExpandConstant('{app}\Images');
  if not DirExists(ImagesDir) then
  begin
    Result := True;
  end
  else
  begin
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

  ShouldSeedImagesResult := Result;
  ShouldSeedImagesChecked := True;
end;
