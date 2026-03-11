"""
Module pour charger la configuration des modèles à partir du fichier models.toml
"""

import os
import toml
from typing import Dict, Any

class ModelConfig:
    """Gère le chargement et l'accès à la configuration des modèles."""
    
    def __init__(self, config_path: str = "models.toml"):
        """
        Initialise la configuration des modèles.
        
        Args:
            config_path: Chemin vers le fichier de configuration TOML
        """
        # Si le chemin n'est pas absolu, le chercher relativement au répertoire courant
        if not os.path.isabs(config_path):
            config_path = os.path.join(os.getcwd(), config_path)
        
        self.config_path = config_path
        self.config = self._load_config()
    
    def _load_config(self) -> Dict[str, Any]:
        """Charge la configuration depuis le fichier TOML."""
        try:
            with open(self.config_path, 'r', encoding='utf-8') as f:
                return toml.load(f)
        except FileNotFoundError:
            raise FileNotFoundError(f"Fichier de configuration non trouvé: {self.config_path}")
        except Exception as e:
            raise Exception(f"Erreur lors du chargement de la configuration: {str(e)}")
    
    def get_model_name(self, model_key: str) -> str:
        """
        Obtient le nom réel du modèle à partir d'une clé de modèle.
        
        Args:
            model_key: La clé du modèle (ex: "ollama_qwen3-30b")
            
        Returns:
            Le nom réel du modèle (ex: "qwen3:30b")
        """
        try:
            # Naviguer vers la section appropriée dans la config
            models_section = self.config.get('models', {})
            
            if model_key in models_section:
                return models_section[model_key]
            else:
                raise KeyError(f"Modèle '{model_key}' non trouvé dans la configuration")
        except Exception as e:
            raise ValueError(f"Clé de modèle invalide: {model_key}")
    
    def get_default_model(self) -> str:
        """
        Obtient la clé du modèle par défaut depuis la configuration.
        
        Returns:
            La clé du modèle par défaut
        """
        default_section = self.config.get('default', {})
        return default_section.get('model', 'ollama_qwen3-30b')
    
    def list_models(self) -> Dict[str, str]:
        """
        Liste tous les modèles disponibles.
        
        Returns:
            Dictionnaire associant les clés de modèles à leurs noms réels
        """
        return self.config.get('models', {})

# Exemple d'utilisation
if __name__ == "__main__":
    # Charger la configuration
    config = ModelConfig()
    
    # Obtenir le modèle par défaut
    default_model = config.get_default_model()
    print(f"Modèle par défaut: {default_model}")
    
    # Obtenir le nom réel du modèle
    actual_name = config.get_model_name(default_model)
    print(f"Nom réel: {actual_name}")
    
    # Lister tous les modèles
    print("\nModèles disponibles:")
    for key, name in config.list_models().items():
        print(f"  {key}: {name}")