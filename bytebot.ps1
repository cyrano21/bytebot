# Script PowerShell pour démarrer Bytebot (Windows)

param(
    [Parameter(Position=0)]
    [string]$Command = "start"
)

function Start-Services {
    Write-Host "=== Démarrage de Bytebot ===" -ForegroundColor Green
    
    # Vérifier si Node.js est installé
    try {
        $nodeVersion = & node --version
        Write-Host "Node.js version: $nodeVersion" -ForegroundColor Cyan
    } catch {
        Write-Host "ERREUR: Node.js n'est pas installé." -ForegroundColor Red
        Write-Host "Veuillez installer Node.js (version 18 ou supérieure) avant de continuer." -ForegroundColor Yellow
        exit 1
    }
    
    # Vérifier si npm est installé
    try {
        $npmVersion = & npm --version
        Write-Host "npm version: $npmVersion" -ForegroundColor Cyan
    } catch {
        Write-Host "ERREUR: npm n'est pas installé." -ForegroundColor Red
        Write-Host "Veuillez installer Node.js/npm avant de continuer." -ForegroundColor Yellow
        exit 1
    }
    
    # Créer le répertoire de logs si nécessaire
    if (!(Test-Path -Path "logs")) {
        New-Item -ItemType Directory -Path "logs" | Out-Null
    }
    
    # Démarrage de l'agent Bytebot
    Write-Host "Démarrage de l'agent Bytebot..." -ForegroundColor Blue
    Set-Location -Path "packages\bytebot-agent"
    
    # Installer les dépendances si nécessaire
    if (!(Test-Path -Path "node_modules")) {
        Write-Host "Installation des dépendances de l'agent..." -ForegroundColor Yellow
        npm install
    }
    
    # Démarrer l'agent en arrière-plan
    Start-Process -NoNewWindow -FilePath "npm" -ArgumentList "start" -PassThru
    Set-Location -Path "..\.."
    
    # Démarrage de l'interface utilisateur
    Write-Host "Démarrage de l'interface utilisateur..." -ForegroundColor Blue
    Set-Location -Path "packages\bytebot-ui"
    
    # Installer les dépendances si nécessaire
    if (!(Test-Path -Path "node_modules")) {
        Write-Host "Installation des dépendances de l'interface..." -ForegroundColor Yellow
        npm install
    }
    
    # Démarrer l'interface en arrière-plan
    Start-Process -NoNewWindow -FilePath "npm" -ArgumentList "run", "dev" -PassThru
    Set-Location -Path "..\.."
    
    Write-Host ""
    Write-Host "Bytebot est maintenant en cours d'exécution !" -ForegroundColor Green
    Write-Host ""
    Write-Host "Vous pouvez accéder aux interfaces via :" -ForegroundColor White
    Write-Host "  - Interface utilisateur: http://localhost:3000" -ForegroundColor White
    Write-Host "  - API de l'agent: http://localhost:3001" -ForegroundColor White
    Write-Host ""
    Write-Host "Appuyez sur Ctrl+C pour arrêter les services." -ForegroundColor Yellow
}

function Stop-Services {
    Write-Host "=== Arrêt de Bytebot ===" -ForegroundColor Green
    
    # Tuer tous les processus Node.js (approche simple)
    Write-Host "Arrêt des processus Node.js..." -ForegroundColor Blue
    taskkill /F /IM node.exe 2>$null
    
    Write-Host "Services arrêtés." -ForegroundColor Green
}

# Exécuter la commande appropriée
switch ($Command) {
    "start" { 
        Start-Services
        # Garder le script en cours d'exécution
        try {
            Write-Host "Appuyez sur Ctrl+C pour arrêter..." -ForegroundColor Yellow
            while ($true) { Start-Sleep -Seconds 1 }
        } catch {
            Stop-Services
        }
    }
    "stop" { Stop-Services }
    default { 
        Write-Host "Commande inconnue. Utilisez 'start' ou 'stop'." -ForegroundColor Red
        exit 1
    }
}