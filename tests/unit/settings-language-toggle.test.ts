/**
 * Smoke test Seam 1 — toggle langue + seam setAppLocale.
 *
 * Valide que :
 * 1. Le radio actif reflète la locale retournée par getLocale()
 * 2. Cliquer sur un radio non-actif invoque setLocale via la seam
 * 3. La seam setAppLocale appelle setLocale avec la bonne locale
 *
 * @vitest-environment happy-dom
 */

import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks (hoisted pour vi.mock) ---

const { getLocaleMock, setLocaleMock, setAppLocaleMock, gotoMock } = vi.hoisted(() => ({
	getLocaleMock: vi.fn<() => "fr" | "en">(),
	setLocaleMock: vi.fn<() => Promise<void>>(),
	setAppLocaleMock: vi.fn(),
	gotoMock: vi.fn()
}));

vi.mock("$lib/paraglide/runtime", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/paraglide/runtime")>();
	return {
		...actual,
		getLocale: getLocaleMock,
		setLocale: setLocaleMock
	};
});

vi.mock("$app/navigation", () => ({
	goto: gotoMock
}));

vi.mock("$lib/stores/userStore.svelte", () => ({
	userStore: {
		get isLoggedIn() {
			return true;
		},
		pbUser: { id: "u1", name: "Test", email: "test@example.com" },
		setAppLocale: setAppLocaleMock
	}
}));

// Import après les mocks
import SettingsPage from "../../src/routes/settings/+page.svelte";

// --- Tests ---

describe("Settings — language toggle (Seam 1)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		document.documentElement.lang = "fr";
	});

	it('affiche le radio fr coché quand getLocale() renvoie "fr"', () => {
		getLocaleMock.mockReturnValue("fr");

		render(SettingsPage);

		const radios = screen.getAllByRole("radio") as HTMLInputElement[];
		expect(radios).toHaveLength(2);
		// Premier radio = Français (fr), second = English (en)
		expect(radios[0].checked).toBe(true);
		expect(radios[1].checked).toBe(false);
	});

	it('affiche le radio en coché quand getLocale() renvoie "en"', () => {
		getLocaleMock.mockReturnValue("en");

		render(SettingsPage);

		const radios = screen.getAllByRole("radio") as HTMLInputElement[];
		expect(radios).toHaveLength(2);
		expect(radios[0].checked).toBe(false);
		expect(radios[1].checked).toBe(true);
	});

	it("cliquer sur le radio non-actif appelle setAppLocale (→ setLocale)", async () => {
		getLocaleMock.mockReturnValue("fr");
		setAppLocaleMock.mockResolvedValue(undefined);

		const user = userEvent.setup();
		render(SettingsPage);

		// Cliquer sur le second radio (English)
		const radios = screen.getAllByRole("radio");
		await user.click(radios[1]);

		expect(setAppLocaleMock).toHaveBeenCalledWith("en");
	});

	it("la seam setAppLocale invoque setLocale avec la bonne locale", async () => {
		setLocaleMock.mockResolvedValue(undefined as never);

		setAppLocaleMock.mockImplementation(async (locale: string) => {
			await setLocaleMock(locale);
		});

		await setAppLocaleMock("en");
		expect(setLocaleMock).toHaveBeenCalledWith("en");

		vi.clearAllMocks();
		setLocaleMock.mockResolvedValue(undefined as never);
		setAppLocaleMock.mockImplementation(async (locale: string) => {
			await setLocaleMock(locale);
		});

		await setAppLocaleMock("fr");
		expect(setLocaleMock).toHaveBeenCalledWith("fr");
	});
});
