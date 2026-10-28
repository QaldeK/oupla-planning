/**
 * Détection iOS côté client. Le test user-agent seul rate les iPad récents :
 * depuis iPadOS 13, Safari rapporte un user-agent Macintosh — le multi-touch
 * (maxTouchPoints > 1) est le signal complémentaire fiable.
 *
 * @param userAgent      navigator.userAgent
 * @param maxTouchPoints navigator.maxTouchPoints
 * @returns vrai sur iPhone, iPad, iPod (toutes générations d'iPadOS)
 */
export function isPlatformIos(userAgent: string, maxTouchPoints: number): boolean {
	return /iPad|iPhone|iPod/.test(userAgent) || (/Mac/.test(userAgent) && maxTouchPoints > 1);
}

/** Variante pratique pour un appelant navigateur. */
export function isIosDevice(nav: Navigator): boolean {
	return isPlatformIos(nav.userAgent, nav.maxTouchPoints);
}
