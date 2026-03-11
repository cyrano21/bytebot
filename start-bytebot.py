import os
import sys
import subprocess
import signal
import time

# Liste des processus démarrés
processes = []

def signal_handler(sig, frame):
    print("\nArrêt des services...")
    for process in processes:
        try:
            process.terminate()
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
    print("Services arrêtés.")
    sys.exit(0)

def start_service(command, name):
    print(f"Démarrage de {name}...")
    try:
        process = subprocess.Popen(command, shell=True)
        processes.append(process)
        print(f"{name} démarré avec PID {process.pid}")
        return process
    except Exception as e:
        print(f"Erreur lors du démarrage de {name}: {e}")
        return None

def main():
    # Enregistrer le gestionnaire de signal pour l'arrêt propre
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    print("=== Démarrage de Bytebot ===")
    
    # Créer le répertoire de logs si nécessaire
    os.makedirs("logs", exist_ok=True)
    
    # Démarrage du serveur X virtuel (nécessite Xvfb)
    xvfb_process = start_service("Xvfb :99 -screen 0 1024x768x24", "Serveur X virtuel")
    if xvfb_process:
        # Attendre que Xvfb démarre
        time.sleep(2)
        
        # Configuration de l'affichage
        os.environ["DISPLAY"] = ":99"
        
        # Démarrage du gestionnaire de fenêtres XFCE
        xfce_process = start_service("xfce4-session", "XFCE")
        
        # Attendre que XFCE démarre
        time.sleep(3)
        
        # Démarrage du serveur VNC pour l'accès à distance
        vnc_process = start_service("x11vnc -display :99 -rfbport 5900 -shared -forever -passwd bytebot", "Serveur VNC")
        
        # Démarrage de l'agent Bytebot
        print("Démarrage de l'agent Bytebot...")
        os.chdir("packages/bytebot-agent")
        agent_process = start_service("npm start", "Agent Bytebot")
        os.chdir("../..")
        
        print("\nBytebot est maintenant en cours d'exécution !")
        print("Vous pouvez accéder à l'interface via :")
        print("  - Bureau virtuel VNC : localhost:5900 (mot de passe: bytebot)")
        print("\nAppuyez sur Ctrl+C pour arrêter.")
        
        # Garder le script en cours d'exécution
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            signal_handler(signal.SIGINT, None)
    else:
        print("Impossible de démarrer le serveur X virtuel. Assurez-vous que Xvfb est installé.")

if __name__ == "__main__":
    main()