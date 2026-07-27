 <script lang="ts">
import { CalendarCog, Check, Copy, Share2 } from "@lucide/svelte";
import { toast } from "svelte-sonner";
import { goto } from "$app/navigation";
import * as m from "$lib/paraglide/messages.js";

interface Props {
	adminToken?: string;
	participantToken?: string;
}

let { adminToken, participantToken }: Props = $props();

let copiedAdmin = $state(false);
let copiedParticipant = $state(false);

// Détecte si le partage natif est disponible
const canNativeShare = typeof navigator !== "undefined" && "share" in navigator;

function getAdminUrl() {
	return `${window.location.origin}/p/${adminToken}`;
}

function getParticipantUrl() {
	return `${window.location.origin}/p/${participantToken}`;
}

async function shareOrCopy(
	url: string,
	label: string,
	copiedState: () => boolean,
	setCopied: (v: boolean) => void
) {
	if (canNativeShare) {
		try {
			await navigator.share({
				title: m.share_planning_title(),
				text: m.share_copied({label}),
				url
			});
			// L'utilisateur a partagé avec succès (ou annulé, pas de distinction)
		} catch (error) {
			// AbortError = utilisateur a annulé, on ne fait rien
			if ((error as Error).name !== "AbortError") {
				toast.error(m.share_error());
			}
		}
	} else {
		// Fallback: copier dans le presse-papiers
		try {
			await navigator.clipboard.writeText(url);
			setCopied(true);
			toast.success(m.share_copied({label}));
			setTimeout(() => setCopied(false), 2000);
		} catch {
			toast.error(m.copy_error());
		}
	}
}

async function shareAdminLink() {
	await shareOrCopy(
		getAdminUrl(),
		"Lien admin",
		() => copiedAdmin,
		(v) => (copiedAdmin = v)
	);
}

async function shareParticipantLink() {
	await shareOrCopy(
		getParticipantUrl(),
		"Lien public",
		() => copiedParticipant,
		(v) => (copiedParticipant = v)
	);
}
</script>

<div class="flex flex-wrap justify-around gap-2">
	{#if adminToken}
		<button
			class="btn btn-primary min-w-1/3 gap-2 max-sm:w-2/3"
			onclick={() => goto(`/admin/${adminToken}`)}
			><CalendarCog size={20} />{m.share_edit_planning()}</button
		>
		<!-- TOCHECK: c'est quoi ces else et copiedAdmin ? -->
		<button class="btn btn-warning min-w-1/3 gap-2" onclick={shareAdminLink}>
			{#if canNativeShare}
				<Share2 size={20} />
			{:else if copiedAdmin}
				<Check size={20} />
			{:else}
				<Copy size={20} />
			{/if}
			{m.share_admin_link()}
		</button>
	{/if}

	{#if participantToken}
		<button class="btn btn-info min-w-1/3 gap-2" onclick={shareParticipantLink}>
			{#if canNativeShare}
				<Share2 size={20} />
			{:else if copiedParticipant}
				<Check size={20} />
			{:else}
				<Copy size={20} />
			{/if}
			{m.share_public_link()}
		</button>
	{/if}
</div>
