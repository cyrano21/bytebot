"""
Script de test pour vérifier la configuration de Bytebot
"""

import sys
import os

# Ajouter le répertoire packages au chemin
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'packages'))

def test_model_config():
    """Teste la configuration des modèles."""
    try:
        from model_config import ModelConfig
        
        # Charger la configuration
        config = ModelConfig()
        
        # Obtenir le modèle par défaut
        default_model = config.get_default_model()
        print(f"✓ Modèle par défaut: {default_model}")
        
        # Obtenir le nom réel du modèle
        actual_name = config.get_model_name(default_model)
        print(f"✓ Nom réel: {actual_name}")
        
        # Lister tous les modèles
        models = config.list_models()
        print(f"✓ Nombre de modèles disponibles: {len(models)}")
        
        print("\nConfiguration des modèles OK!")
        return True
        
    except Exception as e:
        print(f"✗ Erreur lors du test de la configuration des modèles: {e}")
        return False

def test_python_dependencies():
    """Teste les dépendances Python."""
    try:
        import toml
        import requests
        print("✓ Dépendances Python OK!")
        return True
    except ImportError as e:
        print(f"✗ Dépendance Python manquante: {e}")
        return False

def test_nodejs():
    """Teste si Node.js est installé."""
    try:
        import subprocess
        result = subprocess.run(['node', '--version'], 
                                capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            print(f"✓ Node.js installé: {result.stdout.strip()}")
            return True
        else:
            print("✗ Node.js n'est pas installé ou n'est pas dans le PATH")
            return False
    except Exception as e:
        print(f"✗ Erreur lors de la vérification de Node.js: {e}")
        return False

def main():
    """Fonction principale de test."""
    print("=== Test de la configuration de Bytebot ===\n")
    
    # Tests
    tests = [
        test_python_dependencies,
        test_nodejs,
        test_model_config
    ]
    
    results = []
    for test in tests:
        results.append(test())
        print()
    
    # Résumé
    passed = sum(results)
    total = len(results)
    
    print(f"=== Résumé: {passed}/{total} tests réussis ===")
    
    if passed == total:
        print("🎉 Tous les tests ont réussi! Bytebot est prêt à être utilisé.")
        return 0
    else:
        print("❌ Certains tests ont échoué. Veuillez vérifier la configuration.")
        return 1

if __name__ == "__main__":
    sys.exit(main())
