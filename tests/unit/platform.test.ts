/**
 * Tests unitaires — détection iOS (fonction pure).
 *
 * Le test user-agent seul rate les iPad récents : depuis iPadOS 13, Safari
 * rapporte un user-agent Macintosh, et l'utilisateur se voyait offrir les
 * instructions Android. Le multi-touch (maxTouchPoints > 1 sur un user-agent
 * Mac) est le signal complémentaire.
 */
import { describe, expect, it } from "vitest";
import { isPlatformIos } from "$lib/utils/platform";

const IOS_IPHONE_UA =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD_UA =
	"Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
const IPADOS_13_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const WINDOWS_TOUCH_UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const FIREFOX_ANDROID_UA = "Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0";

describe("isPlatformIos", () => {
	it("iPhone → vrai", () => {
		expect(isPlatformIos(IOS_IPHONE_UA, 5)).toBe(true);
	});

	it("iPad avec user-agent iPad → vrai", () => {
		expect(isPlatformIos(IPAD_UA, 5)).toBe(true);
	});

	it("iPadOS 13+ (user-agent Macintosh + multi-touch) → vrai", () => {
		expect(isPlatformIos(IPADOS_13_UA, 5)).toBe(true);
	});

	it("Mac desktop sans touch → faux", () => {
		expect(isPlatformIos(IPADOS_13_UA, 0)).toBe(false);
	});

	it("Windows tactile → faux (multi-touch mais pas Mac)", () => {
		expect(isPlatformIos(WINDOWS_TOUCH_UA, 10)).toBe(false);
	});

	it("Android Firefox → faux", () => {
		expect(isPlatformIos(FIREFOX_ANDROID_UA, 5)).toBe(false);
	});
});
