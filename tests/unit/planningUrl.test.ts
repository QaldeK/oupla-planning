/**
 * Tests unitaires — utils/planningUrl.ts (resolvePlanningLink)
 *
 * Contrat : normalise toute entrée acceptée (URL absolue tout domaine, chemin
 * relatif /p/ ou /admin/, token nu 32 hex participant ou 64 hex admin) vers
 * la route interne à passer à goto() ; null pour toute autre entrée. La casse
 * hexadécimale est normalisée en minuscules.
 */
import { describe, expect, it } from "vitest";
import { resolvePlanningLink } from "$lib/utils/planningUrl";

const PARTICIPANT = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const ADMIN = "f".repeat(64);

describe("resolvePlanningLink", () => {
	it("extrait le token d'une URL participant absolue", () => {
		expect(resolvePlanningLink(`https://planning.oupla.net/p/${PARTICIPANT}`)).toBe(
			`/p/${PARTICIPANT}`,
		);
	});

	it("extrait le token d'une URL admin avec segment de suffixe et query", () => {
		expect(resolvePlanningLink(`https://oupla.net/admin/${ADMIN}/archive?x=1`)).toBe(
			`/admin/${ADMIN}`,
		);
	});

	it("accepte un chemin relatif", () => {
		expect(resolvePlanningLink(`/p/${PARTICIPANT}`)).toBe(`/p/${PARTICIPANT}`);
	});

	it("accepte une URL collée sans protocole", () => {
		expect(resolvePlanningLink(`planning.oupla.net/p/${PARTICIPANT}`)).toBe(`/p/${PARTICIPANT}`);
	});

	it("résout un token participant nu (32 hex)", () => {
		expect(resolvePlanningLink(PARTICIPANT)).toBe(`/p/${PARTICIPANT}`);
	});

	it("résout un token admin nu (64 hex) vers la vue admin", () => {
		expect(resolvePlanningLink(ADMIN)).toBe(`/admin/${ADMIN}`);
	});

	it("normalise la casse hexadécimale", () => {
		expect(resolvePlanningLink(PARTICIPANT.toUpperCase())).toBe(`/p/${PARTICIPANT}`);
		expect(resolvePlanningLink(ADMIN.toUpperCase())).toBe(`/admin/${ADMIN}`);
	});

	it("tolère les espaces autour de l'entrée", () => {
		expect(resolvePlanningLink(`  https://x.io/p/${PARTICIPANT}  `)).toBe(`/p/${PARTICIPANT}`);
	});

	it("rejette un token nu de longueur inconnue", () => {
		expect(resolvePlanningLink("a".repeat(40))).toBeNull();
		expect(resolvePlanningLink("a".repeat(16))).toBeNull();
	});

	it("rejette un segment non hexadécimal", () => {
		expect(resolvePlanningLink("https://x.io/p/not-a-token")).toBeNull();
		expect(resolvePlanningLink("/p/partage")).toBeNull();
	});

	it("rejette un texte libre, une chaîne vide, des espaces", () => {
		expect(resolvePlanningLink("rejoins mon planning !")).toBeNull();
		expect(resolvePlanningLink("")).toBeNull();
		expect(resolvePlanningLink("   ")).toBeNull();
	});
});
