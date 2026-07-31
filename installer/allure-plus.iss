#define MyAppName "Allure+"
#define MyAppVersion "1.0"
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
OutputBaseFilename=AllurePlus_Setup
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
Source: "..\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion; Excludes: "\node_modules,\node_modules\*,\.git,\.git\*,\.claude,\.claude\*,\installer,\installer\*,\.env,\.campus_token,\.garmin_tokens,\.garmin_tokens\*,\cache.json,\imported_plan.json,\*.log,\Allure+.lnk"

[Icons]
Name: "{group}\Allure+"; Filename: "{app}\start.bat"; WorkingDir: "{app}"; IconFilename: "{app}\logo-allure.ico"
Name: "{group}\Arreter Allure+"; Filename: "{app}\stop_serveur.bat"; WorkingDir: "{app}"; IconFilename: "{app}\logo-allure.ico"
Name: "{group}\Desinstaller Allure+"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\install.bat"; WorkingDir: "{app}"; Flags: waituntilterminated; Description: "Installer Node.js et les dependances d'Allure+"
