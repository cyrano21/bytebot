# Script PowerShell pour démarrer Bytebot sur Windows

Write-Host "=== Démarrage de Bytebot ==="

# Vérifier si Node.js est installé
try {
    $nodeVersion = & node --version
    Write-Host "Node.js version: $nodeVersion"
} catch {
    Write-Host "Node.js n'est pas installé. Veuillez installer Node.js avant de continuer."
    exit 1
}

# Vérifier si npm est installé
try {
    $npmVersion = & npm --version
    Write-Host "npm version: $npmVersion"
} catch {
    Write-Host "npm n'est pas installé. Veuillez installer Node.js/npm avant de continuer."
    exit 1
}

# Créer le répertoire de logs si nécessaire
if (!(Test-Path -Path "logs")) {
    New-Item -ItemType Directory -Path "logs" | Out-Null
}

# Démarrage de l'agent Bytebot
Write-Host "Démarrage de l'agent Bytebot..."
Set-Location -Path "packages\bytebot-agent"
Start-Process -NoNewWindow -FilePath "npm" -ArgumentList "start" -PassThru
Set-Location -Path "..\.."

# Démarrage de l'interface utilisateur
Write-Host "Démarrage de l'interface utilisateur..."
Set-Location -Path "packages\bytebot-ui"
Start-Process -NoNewWindow -FilePath "npm" -ArgumentList "run", "dev" -PassThru
Set-Location -Path "..\.."

Write-Host ""
Write-Host "Bytebot est maintenant en cours d'exécution !"
Write-Host ""
Write-Host "Vous pouvez accéder aux interfaces via :"
Write-Host "  - Interface utilisateur: http://localhost:3000"
Write-Host "  - API de l'agent: http://localhost:3001"
Write-Host ""
Write-Host "Appuyez sur Entrée pour arrêter les services..."
Read-Host