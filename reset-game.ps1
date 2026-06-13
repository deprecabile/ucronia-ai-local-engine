# Reset dei file di gioco allo stato iniziale (turno 0 dello scenario) — versione Windows/PowerShell.
# Equivalente di reset-game.sh.
#
# Lo stato di partenza autorevole vive nell'archivio `game_initial_status.zip` (nella root del
# progetto): contiene i quattro snapshot movimento/nazione/attori/cronologia.md così com'erano al
# turno 0. Questo script li estrae in `game\`, sovrascrivendo la partita in corso, e rimuove il
# recap derivato `_ultimo_turno.md` (lo rigenera il backend a fine turno).
#
# Uso:  .\reset-game.ps1 [-Force]
#   senza -Force chiede conferma, perché sovrascrive la partita in corso.
[CmdletBinding()]
param([switch]$Force)

$ErrorActionPreference = 'Stop'

# Root del progetto = cartella di questo script.
$RepoRoot = $PSScriptRoot
$Zip      = Join-Path $RepoRoot 'game_initial_status.zip'
$GameDir  = Join-Path $RepoRoot 'game'
$Recap    = Join-Path $GameDir  '_ultimo_turno.md'

# Nomi dei file COSÌ COME COMPAIONO NELL'ARCHIVIO (alla radice dello zip, senza prefisso game/).
$GameFiles = @('movimento.md', 'nazione.md', 'attori.md', 'cronologia.md')

# Verifica che l'archivio sorgente esista.
if (-not (Test-Path -LiteralPath $Zip)) {
    Write-Error "Archivio '$Zip' non trovato nella root del progetto. È lì che vive lo stato iniziale (turno 0)."
    exit 1
}

Add-Type -AssemblyName System.IO.Compression.FileSystem

# Apri l'archivio e verifica che contenga davvero i quattro file attesi (alla radice).
$archive = [System.IO.Compression.ZipFile]::OpenRead($Zip)
try {
    $entryNames = $archive.Entries | ForEach-Object { $_.FullName }
    foreach ($f in $GameFiles) {
        if ($entryNames -notcontains $f) {
            Write-Host "Errore: '$f' assente in '$Zip' (o non alla radice dell'archivio)." -ForegroundColor Red
            Write-Host "Contenuto dell'archivio:" -ForegroundColor Red
            $entryNames | ForEach-Object { Write-Host "  $_" }
            exit 1
        }
    }

    # Conferma, a meno di -Force.
    if (-not $Force) {
        Write-Host "Sto per RIPRISTINARE la partita al turno 0 (stato iniziale) da '$Zip'."
        Write-Host "Verranno sovrascritti in game\: $($GameFiles -join ', ')"
        Write-Host "e cancellato il recap: $Recap"
        $ans = Read-Host 'Procedo? [y/N]'
        if ($ans -ne 'y' -and $ans -ne 'Y') {
            Write-Host 'Annullato.'
            exit 0
        }
    }

    # Estrae gli snapshot dallo stato iniziale dentro game\ (sovrascrivendo).
    if (-not (Test-Path -LiteralPath $GameDir)) {
        New-Item -ItemType Directory -Path $GameDir | Out-Null
    }
    foreach ($f in $GameFiles) {
        $entry = $archive.GetEntry($f)
        $dest  = Join-Path $GameDir $f
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $dest, $true)
    }
}
finally {
    $archive.Dispose()
}

# Rimuove il recap derivato (è in .gitignore: il backend lo rigenera a fine turno).
if (Test-Path -LiteralPath $Recap) {
    Remove-Item -LiteralPath $Recap -Force
}

Write-Host "OK Partita riportata al turno 0 (stato iniziale)." -ForegroundColor Green
