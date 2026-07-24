# Auth par token en query parameter (pas headers)

Les tokens d'accès (`adminToken`, `participantToken`) sont transmis via le query parameter `_token` dans l'URL plutôt que dans les headers HTTP. Ce choix permet le partage de planning par simple copie d'URL (un lien contient tout ce qu'il faut pour accéder) et fonctionne sans JavaScript côté client.

L'alternative standard (headers `Authorization: Bearer`) nécessiterait un traitement JS pour extraire et injecter le token, ce qui casserait le flux de partage URL direct et rendrait l'application dépendante de JavaScript pour l'accès initial.
