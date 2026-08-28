#define MyAppName "Allure+"
#define MyAppVersion "1.68.0"
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

[Tasks]
; checkedonce : cochee par defaut (comme la plupart des installeurs), mais
; seulement la toute PREMIERE fois qu'elle est proposee a un utilisateur -
; une mise a jour ulterieure respecte alors son choix reel (decochee s'il
; l'a explicitement decochee) plutot que de la re-cocher a chaque fois.
Name: "desktopicon"; Description: "Créer une icône sur le Bureau"; GroupDescription: "Icônes supplémentaires :"; Flags: checkedonce

[Icons]
; Filename pointe vers cmd.exe (un vrai .exe) plutot que directement vers
; start.bat : Windows refuse "Epingler a la barre des taches" (menu
; contextuel ET glisser-depose) pour un raccourci dont la cible est un
; script .bat/.cmd - constate en conditions reelles (retour utilisateur,
; 25/08). cmd.exe /c "...start.bat" lance exactement le meme script (qui
; gere lui-meme le demarrage serveur + ouverture du navigateur en mode
; app), mais la cible etant un .exe reconnu, l'epinglage fonctionne
; directement au clic droit, sans contournement manuel. runminimized :
; la fenetre de commande (juste le temps que start.bat demarre le serveur)
; reste discrete plutot que de s'afficher en plein ecran.
Name: "{group}\Allure+"; Filename: "{cmd}"; Parameters: "/c ""{app}\start.bat"""; WorkingDir: "{app}"; IconFilename: "{app}\logo-allure.ico"; Flags: runminimized
Name: "{autodesktop}\Allure+"; Filename: "{cmd}"; Parameters: "/c ""{app}\start.bat"""; WorkingDir: "{app}"; IconFilename: "{app}\logo-allure.ico"; Flags: runminimized; Tasks: desktopicon
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
// Migration a usage unique (1.67.0) : les versions precedentes creaient le
// raccourci Bureau via install.bat/creer_raccourci.ps1 (retire depuis),
// pointant DIRECTEMENT sur start.bat - jamais epinglable a la barre des
// taches. Laisse tel quel, il coexisterait EN DOUBLE avec le nouveau
// raccourci Bureau cree par ce meme installeur juste apres (meme nom
// "Allure+", mais deux dossiers differents - bureau personnel pour
// l'ancien, bureau commun pour le nouveau - Windows ne les fusionne pas en
// un seul, retour utilisateur explicite). Supprime l'ancien UNIQUEMENT si
// sa cible correspond exactement a l'ancien format automatique - jamais si
// l'utilisateur l'a personnalise a la main (ex: fait pointer vers cmd.exe
// pour le rendre epinglable lui-meme) : un raccourci que l'utilisateur a
// deja corrige de ses propres mains ne doit jamais etre efface
// silencieusement.
function GetShortcutTargetPath(const LnkPath: String): String;
var
  Shell: Variant;
  Link: Variant;
begin
  Result := '';
  if not FileExists(LnkPath) then Exit;
  try
    Shell := CreateOleObject('WScript.Shell');
    Link := Shell.CreateShortcut(LnkPath);
    Result := Link.TargetPath;
  except
    Result := '';
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  OldDesktopLnk, OldTarget, ExpectedOldTarget: String;
begin
  if CurStep = ssPostInstall then
  begin
    OldDesktopLnk := ExpandConstant('{userdesktop}\Allure+.lnk');
    ExpectedOldTarget := ExpandConstant('{app}\start.bat');
    OldTarget := GetShortcutTargetPath(OldDesktopLnk);
    if (OldTarget <> '') and (CompareText(OldTarget, ExpectedOldTarget) = 0) then
      DeleteFile(OldDesktopLnk);
  end;
end;

// Epingler a la barre des taches ne peut pas etre automatise depuis un
// installeur : Microsoft a retire cette possibilite programmatique depuis
// Windows 10 (~2016), precisement pour empecher les installeurs de le
// faire sans action explicite de l'utilisateur - aucun contournement
// legitime cote Inno Setup. Le raccourci cree ci-dessus pointant vers
// cmd.exe (pas start.bat directement) rend desormais "Epingler a la barre
// des taches" disponible en un clic droit (voir commentaire [Icons]) - on
// se contente donc d'informer l'utilisateur de ce raccourci sur la
// derniere page de l'assistant, plutot que d'une automatisation impossible.
procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpFinished then
    WizardForm.FinishedLabel.Caption := WizardForm.FinishedLabel.Caption + #13#10#13#10 +
      'Astuce : pour un accès encore plus rapide, faites un clic droit sur le raccourci Allure+ (menu Démarrer ou Bureau) puis choisissez "Épingler à la barre des tâches".';
end;

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
