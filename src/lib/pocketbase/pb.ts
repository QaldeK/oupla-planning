import PocketBase from "pocketbase";
import type { TypedPocketBase } from "$lib/types/pocketbase-types";

// URL de l'instance PocketBase dédiée au planning
// À configurer selon votre environnement
const PB_URL = import.meta.env.VITE_PLANNING_PB_URL || "http://127.0.0.1:8090";

export const pb = new PocketBase(PB_URL) as TypedPocketBase;

// Désactiver l'auto-cancel pour éviter les problèmes avec les requêtes concurrentes
pb.autoCancellation(false);

// Les tokens d'accès (adminToken, participantToken) sont transmis via le
// query parameter _token sur chaque requête PocketBase nécessitant une
// authorization (createRule/updateRule/deleteRule). Voir ADR-0001 et ADR-0012.
