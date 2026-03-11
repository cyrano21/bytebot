#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import sys
from dotenv import load_dotenv
from packages.model_config import ModelConfig

def load_environment():
    """Load environment variables from .env file."""
    load_dotenv()

def main():
    """Main application entry point."""
    print("=== Bytebot - Interface de Modeles IA ===")
    print()
    
    # Load environment variables
    load_environment()
    
    # Initialize model configuration
    try:
        config = ModelConfig()
    except Exception as e:
        print(f"Erreur lors du chargement de la configuration: {e}")
        sys.exit(1)
    
    # Display default model
    default_model = config.get_default_model()
    actual_name = config.get_model_name(default_model)
    print(f"Modele par defaut: {default_model} ({actual_name})")
    print()
    
    # Display all available models
    print("Modeles disponibles:")
    models = config.list_models()
    for i, (key, name) in enumerate(models.items(), 1):
        marker = " (defaut)" if key == default_model else ""
        print(f"  {i}. {key}: {name}{marker}")
    print()
    
    # Check if OpenRouter API key is available
    openrouter_key = os.getenv("OPENROUTER_API_KEY")
    if openrouter_key:
        print("[OK] Cle API OpenRouter detectee")
    else:
        print("[WARN] Cle API OpenRouter non trouvee (certains modeles ne seront pas accessibles)")
    print()
    
    # Simple interactive loop
    print("Tapez 'help' pour la liste des commandes, 'quit' pour quitter.")
    print()
    
    while True:
        try:
            command = input("> ").strip().lower()
            
            if command == "quit" or command == "exit":
                print("Au revoir!")
                break
            elif command == "help":
                print("Commandes disponibles:")
                print("  help    - Affiche cette aide")
                print("  list    - Liste tous les modeles")
                print("  default - Affiche le modele par defaut")
                print("  quit    - Quitte l'application")
                print()
            elif command == "list":
                print("Modeles disponibles:")
                for i, (key, name) in enumerate(models.items(), 1):
                    marker = " (defaut)" if key == default_model else ""
                    print(f"  {i}. {key}: {name}{marker}")
                print()
            elif command == "default":
                print(f"Modele par defaut: {default_model} ({actual_name})")
                print()
            else:
                print("Commande inconnue. Tapez 'help' pour la liste des commandes.")
                print()
                
        except KeyboardInterrupt:
            print("\nAu revoir!")
            break
        except EOFError:
            print("\nAu revoir!")
            break

if __name__ == "__main__":
    main()