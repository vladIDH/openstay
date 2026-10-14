<#
  Installa (o aggiorna) Fairnight su Windows.

  Si lancia con un doppio clic su "Installa Fairnight.cmd". Cosa fa:
  1. controlla che ci sia Node.js 22 o più recente; se manca spiega come installarlo
     (non scarica niente da solo);
  2. installa Fairnight nella cartella Fairnight dell'utente (C:\Users\<nome>\Fairnight\programma):
     dalla copia del progetto, se questo file sta dentro il progetto, altrimenti da npm;
  3. crea l'icona Fairnight sul desktop e nel menu Start;
  4. la prima volta fa partire la configurazione guidata, poi apre il calendario.
  I dati (impostazioni e calendari) stanno solo in quella cartella. Rilanciarlo aggiorna
  il programma e non tocca i dati.
#>
param(
  # Dove installare: per le prove si usa una cartella a parte.
  [string]$Cartella = (Join-Path $env:USERPROFILE 'Fairnight'),
  # Nessuna domanda e nessuna pausa (prove automatiche).
  [switch]$SenzaDomande,
  # Alla fine non apre il calendario.
  [switch]$NonAprire,
  # Non crea l'icona sul desktop e nel menu Start.
  [switch]$SenzaCollegamenti
)

$ErrorActionPreference = 'Stop'
$NodeMinimo = 22
$PaginaNode = 'https://nodejs.org/it/download'
$Pacchetti = @('fairnight', 'fairguest', 'fairnight-smoobu', 'fairnight-beds24', 'fairnight-market', 'fairnight-cli')

$Programma = Join-Path $Cartella 'programma'
$Log = Join-Path $Cartella 'installazione.log'
$Progetto = Split-Path $PSScriptRoot -Parent
$DalProgetto = Test-Path (Join-Path $Progetto 'packages\fairnight-cli\package.json')

function Scrivi([string]$testo, [string]$colore = 'Gray') { Write-Host $testo -ForegroundColor $colore }
function Fatto([string]$testo) { Write-Host "  OK  $testo" -ForegroundColor Green }

function Fermati([string[]]$righe, [string]$apri = '') {
  Write-Host ''
  foreach ($r in $righe) { Write-Host $r -ForegroundColor Yellow }
  Write-Host ''
  if (-not $SenzaDomande) {
    if ($apri) {
      Read-Host 'Premi Invio per aprire la pagina nel browser (oppure chiudi questa finestra)' | Out-Null
      Start-Process $apri
    } else {
      Read-Host 'Premi Invio per chiudere' | Out-Null
    }
  }
  exit 1
}

function TrovaNode {
  $comando = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($comando) { return $comando.Source }
  # Appena installato, Node.js può non essere ancora nel PATH di questa finestra.
  foreach ($p in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) {
    if ($p -and (Test-Path $p)) { return $p }
  }
  return $null
}

# Esegue npm nella cartella data e mette tutto quello che stampa nel registro dell'installazione.
# Gli argomenti con spazi vanno già tra virgolette.
function Esegui([string]$dove, [string]$argomenti) {
  Add-Content -Path $Log -Value "`r`n> npm $argomenti  (in $dove)" -Encoding UTF8
  $uscita = Join-Path $Cartella 'npm-uscita.tmp'
  $errori = Join-Path $Cartella 'npm-errori.tmp'
  $p = Start-Process -FilePath $npm -ArgumentList $argomenti -WorkingDirectory $dove -NoNewWindow -Wait -PassThru `
    -RedirectStandardOutput $uscita -RedirectStandardError $errori
  foreach ($f in @($uscita, $errori)) {
    if (Test-Path $f) {
      Get-Content $f | Add-Content -Path $Log -Encoding UTF8
      Remove-Item -Force $f
    }
  }
  return $p.ExitCode
}

function NonRiuscito([string]$cosa) {
  $coda = @()
  if (Test-Path $Log) { $coda = Get-Content $Log -Tail 15 }
  foreach ($r in $coda) { Write-Host "    $r" -ForegroundColor DarkGray }
  Fermati @(
    "Non sono riuscito a $cosa.",
    "Il resoconto completo è nel file: $Log",
    'Mandacelo per email o in un messaggio: lo guardiamo noi. I tuoi dati non sono stati toccati.'
  )
}

Write-Host ''
Scrivi 'Fairnight: i prezzi delle tue notti, calcolati sul tuo computer' 'Cyan'
Scrivi '---------------------------------------------------------------' 'Cyan'

# 1. Node.js
$node = TrovaNode
if (-not $node) {
  Fermati @(
    'Per far funzionare Fairnight serve Node.js, un programma gratuito (versione 22 o più recente).',
    "  1. Apri la pagina ufficiale: $PaginaNode",
    '  2. Scarica la versione «LTS» per Windows (il file .msi) e installala lasciando le opzioni come sono.',
    '  3. Poi fai di nuovo doppio clic su «Installa Fairnight».'
  ) $PaginaNode
}
$versione = (& $node -p 'process.versions.node').Trim()
$architettura = (& $node -p 'process.arch').Trim()
$maggiore = [int]($versione.Split('.')[0])
if ($maggiore -lt $NodeMinimo) {
  Fermati @(
    "Sul computer c'è Node.js $versione, ma Fairnight ha bisogno della versione $NodeMinimo o più recente.",
    "  1. Apri la pagina ufficiale: $PaginaNode",
    '  2. Scarica la versione «LTS» per Windows e installala: prende il posto di quella vecchia.',
    '  3. Poi fai di nuovo doppio clic su «Installa Fairnight».'
  ) $PaginaNode
}
if ($architettura -ne 'x64') {
  Fermati @(
    "Su questo computer c'è Node.js per processori ${architettura}: Fairnight per ora funziona con la versione x64.",
    "  1. Apri la pagina ufficiale: $PaginaNode",
    '  2. Scarica la versione «LTS» per Windows x64 (va bene anche sui computer con processore ARM) e installala.',
    '  3. Poi fai di nuovo doppio clic su «Installa Fairnight».'
  ) $PaginaNode
}
$npm = Join-Path (Split-Path $node) 'npm.cmd'
if (-not (Test-Path $npm)) {
  Fermati @(
    "Ho trovato Node.js ($node) ma non npm, che di solito arriva insieme.",
    "Reinstalla Node.js dalla pagina ufficiale ($PaginaNode), poi rilancia «Installa Fairnight»."
  ) $PaginaNode
}
$env:Path = "$(Split-Path $node);$env:Path"
Fatto "Node.js $versione"

# 2. Il programma
New-Item -ItemType Directory -Force -Path $Programma | Out-Null
Set-Content -Path $Log -Value "Installazione di Fairnight, $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), Node.js $versione $architettura" -Encoding UTF8
$aggiornamento = Test-Path (Join-Path $Programma 'node_modules\fairnight-cli')
# Ogni volta un elenco nuovo: niente rimandi a pacchetti di installazioni precedenti.
Set-Content -Path (Join-Path $Programma 'package.json') -Encoding ASCII -Value '{ "name": "fairnight-installato", "private": true, "description": "Fairnight installato per questo utente: si aggiorna rilanciando Installa Fairnight" }'
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $Programma 'package-lock.json')

if ($DalProgetto) {
  Scrivi ''
  Scrivi 'Preparo Fairnight dalla copia del progetto (la prima volta 2-4 minuti)...'
  if ((Esegui $Progetto 'ci --no-audit --no-fund') -ne 0) { NonRiuscito 'scaricare i componenti di Fairnight' }
  if ((Esegui $Progetto 'run build') -ne 0) { NonRiuscito 'preparare Fairnight' }
  $cartellaPacchetti = Join-Path $Programma 'pacchetti'
  if (Test-Path $cartellaPacchetti) { Remove-Item -Recurse -Force $cartellaPacchetti }
  New-Item -ItemType Directory -Force -Path $cartellaPacchetti | Out-Null
  $spazi = ($Pacchetti | ForEach-Object { "-w $_" }) -join ' '
  if ((Esegui $Progetto "pack $spazi --pack-destination `"$cartellaPacchetti`"") -ne 0) { NonRiuscito 'impacchettare Fairnight' }
  $daInstallare = (Get-ChildItem $cartellaPacchetti -Filter *.tgz | ForEach-Object { "`"$($_.FullName)`"" }) -join ' '
} else {
  $daInstallare = 'fairnight-cli@latest'
}
Scrivi 'Installo Fairnight...'
if ((Esegui $Programma "install --omit=dev --no-audit --no-fund $daInstallare") -ne 0) { NonRiuscito 'installare Fairnight' }

$sqlite = Join-Path $Programma 'node_modules\better-sqlite3'
if (Test-Path (Join-Path $sqlite 'build\config.gypi')) {
  Add-Content -Path $Log -Value 'better-sqlite3: compilato sul posto (nessun binario precompilato usato)' -Encoding UTF8
} else {
  Add-Content -Path $Log -Value 'better-sqlite3: binario precompilato' -Encoding UTF8
}
$fairnight = Join-Path $Programma 'node_modules\fairnight-cli\bin\fairnight.js'
& $node $fairnight --help *> $null
if ($LASTEXITCODE -ne 0) { NonRiuscito 'avviare Fairnight dopo averlo installato' }
$versioneFairnight = (Get-Content (Join-Path $Programma 'node_modules\fairnight-cli\package.json') -Raw | ConvertFrom-Json).version
if ($aggiornamento) { Fatto "Fairnight $versioneFairnight aggiornato" } else { Fatto "Fairnight $versioneFairnight installato" }

# 3. I file da doppio clic e le icone
$avvio = @'
@echo off
title Fairnight
set "NODE=node"
where node >nul 2>nul || set "NODE=%ProgramFiles%\nodejs\node.exe"
"%NODE%" "%~dp0programma\node_modules\fairnight-cli\bin\fairnight.js" COMANDO --dir "%~dp0."
DOPO
'@
Set-Content -Path (Join-Path $Cartella 'Fairnight.cmd') -Encoding ASCII -Value $avvio.Replace('COMANDO', 'apri').Replace('DOPO', 'if errorlevel 1 pause')
Set-Content -Path (Join-Path $Cartella 'Cambia impostazioni.cmd') -Encoding ASCII -Value $avvio.Replace('COMANDO', 'configura').Replace('DOPO', 'pause')
$icona = Join-Path $Programma 'fairnight.ico'
Copy-Item -Force (Join-Path $PSScriptRoot 'fairnight.ico') $icona

if (-not $SenzaCollegamenti) {
  $shell = New-Object -ComObject WScript.Shell
  foreach ($dove in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
    $link = $shell.CreateShortcut((Join-Path $dove 'Fairnight.lnk'))
    $link.TargetPath = Join-Path $Cartella 'Fairnight.cmd'
    $link.WorkingDirectory = $Cartella
    $link.IconLocation = "$icona,0"
    $link.Description = 'Apre il calendario dei prezzi di Fairnight'
    $link.Save()
  }
  Fatto 'Icona Fairnight sul desktop e nel menu Start'
}

# 4. Configurazione e calendario
$config = Join-Path $Cartella 'fairnight.config.json'
Scrivi ''
Scrivi "I tuoi dati restano solo su questo computer, nella cartella $Cartella" 'Cyan'
if (Test-Path $config) {
  Scrivi 'Le tue impostazioni restano come sono. Per cambiarle: doppio clic su «Cambia impostazioni» nella cartella Fairnight.'
} elseif (-not $SenzaDomande) {
  Scrivi ''
  & $node $fairnight configura --dir $Cartella
  if ($LASTEXITCODE -ne 0) {
    Fermati @('La configurazione non è finita. Quando vuoi, riprendila con un doppio clic su «Cambia impostazioni» nella cartella Fairnight.')
  }
}
if ($NonAprire -or -not (Test-Path $config)) { exit 0 }

Scrivi ''
Scrivi 'Fatto! Da adesso apri Fairnight con l''icona Fairnight sul desktop.' 'Green'
Scrivi ''
& $node $fairnight apri --dir $Cartella
if ($LASTEXITCODE -ne 0 -and -not $SenzaDomande) { Read-Host 'Premi Invio per chiudere' | Out-Null }
