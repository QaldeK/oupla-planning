# Identité par planning pour les guests (pas de profil global)

Pour les utilisateurs non authentifiés (guests), l'identité est scopée à un planning spécifique. Chaque planning sauvegardé localement a son propre `currentUser: { id, name, email }`. Un même utilisateur peut donc avoir des noms différents sur des plannings différents, et il n'y a pas de profil "universel" qui unifierait toutes ses participations.

L'alternative (un profil global par appareil) introduisait une complexité significative : sync bidirectionnelle `globalProfile ↔ savedPlannings`, collisions d'ID, migrations d'identité. Le scoping par planning élimine ces problèmes au prix d'une UX où le nom doit être saisi une fois par planning (pas par occurrence).

Le cas de l'utilisateur authentifié PocketBase est distinct : son identité provient de `pb.authStore.record` et s'applique uniformément à tous ses plannings.
