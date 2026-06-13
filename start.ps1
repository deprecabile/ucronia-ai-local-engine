# Avvia backend (porta 8088) e frontend (porta 5173) insieme — versione Windows/PowerShell.
# Equivalente di start.sh.
#
# I log di entrambi vengono mostrati in console in tempo reale, prefissati con
# [backend] / [frontend]. Ctrl+C ferma entrambi (e i loro sottoprocessi: npm + tsx/vite).
#
# Uso:  .\start.ps1 [-Port 8088]
[CmdletBinding()]
param(
    [int]$Port = $(if ($env:PORT) { [int]$env:PORT } else { 8088 })
)

$ErrorActionPreference = 'Stop'

$RepoRoot = $PSScriptRoot
$Backend  = Join-Path $RepoRoot 'backend'
$Frontend = Join-Path $RepoRoot 'frontend'

# La CLI `claude` deve essere sul PATH e autenticata: l'Agent SDK la usa e ne eredita l'auth.
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    Write-Warning "CLI 'claude' non trovata sul PATH: il backend non riuscirà a contattare il modello."
}

# File di log temporanei (uno stdout + uno stderr per servizio). Start-Process vi redirige
# l'output; noi li leggiamo in coda e li ristampiamo prefissati.
$tmp   = [System.IO.Path]::GetTempPath()
$beOut = Join-Path $tmp "mri-backend-$PID.out.log"
$beErr = Join-Path $tmp "mri-backend-$PID.err.log"
$feOut = Join-Path $tmp "mri-frontend-$PID.out.log"
$feErr = Join-Path $tmp "mri-frontend-$PID.err.log"

# Termina un processo e tutta la sua discendenza (npm -> tsx/vite -> node), puramente in
# PowerShell via l'albero ParentProcessId di CIM. Equivale al kill sul process-group di start.sh.
function Stop-Tree {
    param([int]$Id)
    Get-CimInstance Win32_Process -Filter "ParentProcessId = $Id" -ErrorAction SilentlyContinue |
        ForEach-Object { Stop-Tree -Id $_.ProcessId }
    Stop-Process -Id $Id -Force -ErrorAction SilentlyContinue
}

# Apre un file di log in lettura CONDIVISA (il processo figlio ci sta scrivendo).
function Open-Reader {
    param([string]$Path)
    $fs = [System.IO.FileStream]::new(
        $Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    [System.IO.StreamReader]::new($fs)
}

# Svuota il nuovo contenuto di uno stream e lo stampa riga per riga, prefissato e colorato.
# Ritorna $true se ha letto qualcosa. Con -Final stampa anche l'ultima riga senza newline.
function Write-StreamLines {
    param($Stream, [switch]$Final)
    $chunk = $Stream.Reader.ReadToEnd()
    if ($chunk) { $Stream.Buffer += $chunk }
    while (($i = $Stream.Buffer.IndexOf("`n")) -ge 0) {
        $line = $Stream.Buffer.Substring(0, $i).TrimEnd("`r")
        Write-Host "$($Stream.Tag) $line" -ForegroundColor $Stream.Color
        $Stream.Buffer = $Stream.Buffer.Substring($i + 1)
    }
    if ($Final -and $Stream.Buffer.Trim()) {
        Write-Host "$($Stream.Tag) $($Stream.Buffer.TrimEnd())" -ForegroundColor $Stream.Color
        $Stream.Buffer = ''
    }
    return [bool]$chunk
}

# --- Rete di sicurezza: Windows Job Object con "kill on close" -----------------------------
# Il `finally` qui sotto ferma i processi nel caso normale (Ctrl+C). Ma se questo script venisse
# terminato di BRUTTO (chiusura della finestra, kill forzato, crash) il `finally` non girerebbe e
# npm/tsx/vite resterebbero orfani. Per garantire comunque la terminazione, assegniamo i processi
# figli a un Job Object con JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: quando il processo di start.ps1
# muore — per QUALSIASI motivo — l'handle del job si chiude e il SO uccide tutti i figli.
$killJob = [IntPtr]::Zero
if (-not ('WinJob' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WinJob {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr a, string n);
    [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
    [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr j, int c, IntPtr i, uint l);
    [StructLayout(LayoutKind.Sequential)] struct BASIC {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags;
        public UIntPtr MinWS, MaxWS; public uint ActiveProcessLimit; public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass; }
    [StructLayout(LayoutKind.Sequential)] struct IOC {
        public ulong a,b,c,d,e,f; }
    [StructLayout(LayoutKind.Sequential)] struct EXT {
        public BASIC Basic; public IOC Io; public UIntPtr ProcMem, JobMem, PeakProc, PeakJob; }
    public static IntPtr CreateKillOnClose() {
        IntPtr j = CreateJobObject(IntPtr.Zero, null);
        if (j == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
        EXT e = new EXT(); e.Basic.LimitFlags = 0x2000; // KILL_ON_JOB_CLOSE
        int len = Marshal.SizeOf(e); IntPtr p = Marshal.AllocHGlobal(len);
        Marshal.StructureToPtr(e, p, false);
        bool ok = SetInformationJobObject(j, 9, p, (uint)len); // ExtendedLimitInformation
        Marshal.FreeHGlobal(p);
        if (!ok) throw new System.ComponentModel.Win32Exception();
        return j;
    }
    public static void Assign(IntPtr j, IntPtr p) {
        if (!AssignProcessToJobObject(j, p)) throw new System.ComponentModel.Win32Exception();
    }
}
'@
}
try { $killJob = [WinJob]::CreateKillOnClose() } catch { Write-Warning "Job Object non disponibile: $($_.Exception.Message)" }

Write-Host "[start] backend  -> http://localhost:$Port  (ws ws://localhost:$Port)"
Write-Host "[start] frontend -> http://localhost:5173"
Write-Host "[start] Ctrl+C per fermare entrambi."
Write-Host ""

# Il backend legge la porta da $env:PORT; Start-Process eredita l'ambiente corrente.
$env:PORT = "$Port"

$be = Start-Process -FilePath 'npm.cmd' -ArgumentList 'run', 'dev' -WorkingDirectory $Backend `
    -RedirectStandardOutput $beOut -RedirectStandardError $beErr -NoNewWindow -PassThru
$fe = Start-Process -FilePath 'npm.cmd' -ArgumentList 'run', 'dev' -WorkingDirectory $Frontend `
    -RedirectStandardOutput $feOut -RedirectStandardError $feErr -NoNewWindow -PassThru

# Assegna i due processi (e quindi i loro discendenti) al Job Object kill-on-close.
if ($killJob -ne [IntPtr]::Zero) {
    foreach ($p in @($be, $fe)) {
        try { [WinJob]::Assign($killJob, $p.Handle) } catch { Write-Warning "Assegnazione al Job Object fallita: $($_.Exception.Message)" }
    }
}

# Attendi che i file di log esistano prima di aprirli in lettura.
foreach ($f in @($beOut, $beErr, $feOut, $feErr)) {
    $n = 0
    while (-not (Test-Path -LiteralPath $f) -and $n -lt 50) { Start-Sleep -Milliseconds 100; $n++ }
}

$streams = @(
    @{ Reader = (Open-Reader $beOut); Tag = '[backend] '; Color = 'Cyan';    Buffer = '' },
    @{ Reader = (Open-Reader $beErr); Tag = '[backend] '; Color = 'Cyan';    Buffer = '' },
    @{ Reader = (Open-Reader $feOut); Tag = '[frontend]'; Color = 'Magenta'; Buffer = '' },
    @{ Reader = (Open-Reader $feErr); Tag = '[frontend]'; Color = 'Magenta'; Buffer = '' }
)

try {
    while ($true) {
        $any = $false
        foreach ($s in $streams) { if (Write-StreamLines -Stream $s) { $any = $true } }
        if ($be.HasExited -and $fe.HasExited) { break }
        if (-not $any) { Start-Sleep -Milliseconds 150 }
    }
}
finally {
    Write-Host ""
    Write-Host "[start] arresto in corso..."
    foreach ($p in @($be, $fe)) {
        if ($p -and -not $p.HasExited) { Stop-Tree -Id $p.Id }
    }
    Start-Sleep -Milliseconds 300
    # Ultimo svuotamento dei log, poi chiusura reader e pulizia dei file temporanei.
    foreach ($s in $streams) {
        try { Write-StreamLines -Stream $s -Final | Out-Null } catch {}
        try { $s.Reader.Dispose() } catch {}
    }
    foreach ($f in @($beOut, $beErr, $feOut, $feErr)) {
        Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue
    }
    Write-Host "[start] fermato."
}
