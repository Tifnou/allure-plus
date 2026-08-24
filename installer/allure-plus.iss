#define MyAppName "Allure+"
#define MyAppVersion "1.64.0"
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
; brouter.jar/profiles2/customprofiles sont des fichiers applicatifs (necessaires
; a BRouter au meme titre que le reste du code) et DOIVENT etre embarques - seul
; segments4 (tuiles OSM, ~200 Mo+, telechargees a la demande depuis l'appli, voir
; brouter_manager.js) est exclu. Avant correctif, tout \brouter,\brouter\* etait
; exclu par erreur (meme regle que les donnees utilisateur type data/uploads),
; ce qui rendait la generation d'itineraires impossible sur toute nouvelle
; installation ("BRouter non configure - fichiers manquants").
Source: "..\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion; Excludes: "\node_modules,\node_modules\*,\.git,\.git\*,\.claude,\.claude\*,\installer,\installer\*,\.env,\.campus_token,\.garmin_tokens,\.garmin_tokens\*,\cache.json,\imported_plan.json,\*.log,\Allure+.lnk,\uploads,\uploads\*,\Images,\Images\*,\data,\data\*,\brouter\segments4,\brouter\segments4\*,\support-relay,\support-relay\*,\sync-relay,\sync-relay\*"
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
; Lancement propose via la case a cocher native de la page "Terminer" du
; wizard (postinstall skipifsilent), plutot qu'un prompt O/N dans la console
; install.bat qui laissait cette derniere ouverte en arriere-plan derriere le
; wizard en attendant une saisie clavier (constat utilisateur).
Filename: "{app}\start.bat"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent; Description: "Lancer Allure+"

[Code]
// Ferme une instance Allure+ deja en cours (fenetre navigateur --app +
// serveur node) tout au debut du setup, avant meme la premiere page du
// wizard - sinon, lors d'une mise a jour lancee depuis l'app elle-meme
// (badge "Mise a jour disponible"), l'ancienne fenetre reste ouverte et
// non rafraichie pendant l'installation, puis le postinstall (case
// "Lancer Allure+") en ouvre une SECONDE : deux fenetres Allure+ en meme
// temps au redemarrage (constat utilisateur). Le filtre WINDOWTITLE cible
// precisement la fenetre app-mode du navigateur (son titre de fenetre
// top-level reprend le <title> HTML en mode --app, contrairement au titre
// "Onglet - Google Chrome" habituel en navigation classique) - le reste du
// navigateur de l'utilisateur n'est jamais touche.
function InitializeSetup(): Boolean;
var
  ResultCode: Integer;
begin
  Result := True;
  Exec('taskkill.exe', '/F /FI "WINDOWTITLE eq Allure+ Dashboard*"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec('taskkill.exe', '/F /FI "WINDOWTITLE eq Allure+ - Configuration*"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec('taskkill.exe', '/F /IM node.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Sleep(1500);
end;

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
