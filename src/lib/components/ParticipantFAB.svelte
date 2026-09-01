<script lang="ts">
	import { Bell, EllipsisVertical, Settings, Share2 } from "@lucide/svelte";
	import * as m from "$lib/paraglide/messages.js";

	interface Props {
		isAdmin: boolean;
		adminToken: string | null;
		token: string;
		onShare: (url: string, label: string) => void;
		onNotifClick: () => void;
	}

	let { isAdmin, adminToken, token, onShare, onNotifClick }: Props = $props();

	function closeFab() {
		(document.activeElement as HTMLElement)?.blur();
	}
</script>

<div class="fab z-50">
	<div tabindex="0" role="button" class="btn btn-lg btn-circle btn-primary shadow-lg">
		<EllipsisVertical size={24} class="opacity-70" />
	</div>
	<div class="fab-close">
		<span class="btn btn-circle btn-lg">✕</span>
	</div>
	<div>
		<div class="badge badge-info">{m.fab_share()}</div>
		<button
			class="btn btn-lg btn-circle btn-info shadow-md"
			onclick={() => {
				closeFab();
				onShare(`${window.location.origin}/p/${token}`, m.share_public_link());
			}}
		>
			<Share2 size={20} />
		</button>
	</div>
	{#if isAdmin}
		<div>
			<div class="badge badge-warning">{m.share_admin_link()}</div>
			<button
				class="btn btn-lg btn-circle btn-warning shadow-md"
				onclick={() => {
					closeFab();
					onShare(`${window.location.origin}/p/${adminToken}`, m.share_admin_link());
				}}
			>
				<Share2 size={20} />
			</button>
		</div>
	{/if}
	<div>
		<div class="badge badge-success">{m.fab_notifications()}</div>
		<button
			class="btn btn-lg btn-circle btn-success shadow-md"
			onclick={() => {
				closeFab();
				onNotifClick();
			}}
		>
			<Bell size={20} />
		</button>
	</div>
	{#if isAdmin}
		<div>
			<div class="badge badge-accent">{m.fab_edit()}</div>
			<a href="/admin/{adminToken}" class="btn btn-lg btn-circle btn-accent shadow-md">
				<Settings size={20} />
			</a>
		</div>
	{/if}
</div>
