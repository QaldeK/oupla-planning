<script lang="ts">
	import { MessageSquare, Send, X } from "@lucide/svelte";
	import { toast } from "svelte-sonner";
	import * as m from "$lib/paraglide/messages.js";
	import { commentStateService } from "$lib/services/commentStateService";
	import { addComment } from "$lib/services/planningActions";
	import { drawerStore } from "$lib/stores/drawerStore.svelte";
	import { networkStore } from "$lib/stores/networkStore.svelte";
	import { formatDate, formatDateTime } from "$lib/utils/date";
	import { classifyError } from "$lib/utils/errorHandler";
	import NetworkAlert from "./NetworkAlert.svelte";

	const occurrence = $derived(drawerStore.data?.occurrence);
	const master = $derived(drawerStore.data?.master);
	const currentUserId = $derived(drawerStore.data?.currentUserId);
	const token = $derived(master?.participantToken || master?.adminToken);
	const eventTitle = $derived(master?.title);

	let newComment = $state("");
	let isSubmitting = $state(false);
	let scrollContainer: HTMLDivElement | undefined = $state();

	const isNetworkUnavailable = $derived(!networkStore.isNetworkOk);

	function getParticipantName(id: string) {
		if (!master) return id;
		return master.participants.find((p) => p.id === id)?.name || id;
	}

	$effect(() => {
		if (occurrence?.comments && scrollContainer) {
			setTimeout(() => {
				if (scrollContainer) {
					scrollContainer.scrollTo({
						top: scrollContainer.scrollHeight,
						behavior: "smooth",
					});
				}
			}, 50);
		}
	});

	$effect(() => {
		if (occurrence && drawerStore.open) {
			commentStateService.markConversationAsRead(occurrence.id, occurrence.master);
		}
	});

	async function handleSubmit() {
		if (!newComment.trim() || !occurrence || !master || !currentUserId || !token) return;

		isSubmitting = true;
		try {
			await addComment(occurrence.id, currentUserId, newComment.trim(), token, occurrence);
			commentStateService.markConversationAsRead(occurrence.id, occurrence.master, true);
			newComment = "";
		} catch (error) {
			const { message } = classifyError(error);
			toast.error(message);
			console.error(error);
		} finally {
			isSubmitting = false;
		}
	}
</script>

<div class="flex h-full flex-col">
	{#if occurrence}
		<!-- Header -->
		<div class="border-base-300 flex h-fit items-center justify-between border-b px-4 py-3">
			<div class="flex items-center gap-2">
				<div class="bg-primary/10 flex h-8 w-8 items-center justify-center rounded-lg">
					<MessageSquare size={18} class="text-primary" />
				</div>
				<div>
					<h4 class=" leading-none font-medium">
						{eventTitle} - {formatDate(occurrence.date, "d MMM")}
					</h4>
					<p class="text-base-content/50 mt-1 text-xs">
						{m.comment_message_count({ count: occurrence.comments.length })}
					</p>
				</div>
			</div>
			<button
				class="btn btn-ghost sm:btn-sm btn-circle"
				onclick={() => drawerStore.close()}
				aria-label={m.common_close()}
			>
				<X size={20} />
			</button>
		</div>

		<NetworkAlert message={m.common_server_unavailable()} />

		<div bind:this={scrollContainer} class="h-full flex-1 grow overflow-y-auto p-4">
			{#if occurrence.comments.length > 0}
				<div class="flex flex-col gap-4">
					{#each occurrence.comments as comment (comment.id)}
						{@const isCurrentUser = comment.participantId === currentUserId}
						<div class="chat {isCurrentUser ? 'chat-end' : 'chat-start'} group">
							<div class="chat-header mb-1 text-sm font-bold opacity-50">
								{getParticipantName(comment.participantId)}
								<time class="ml-1 font-normal">{formatDateTime(comment.createdAt)}</time>
							</div>
							<div
								class="chat-bubble relative min-h-0 text-sm shadow-sm {isCurrentUser
									? 'bg-primary/20'
									: 'bg-base-300 text-base-content'}"
							>
								<p class="leading-relaxed whitespace-pre-wrap">{comment.content}</p>
								<!-- FIXIT -->
								<!-- {#if isCurrentUser || isAdmin}
									<button
										class="btn btn-circle btn-error btn-outline btn-xs absolute -top-2 {isCurrentUser
											? '-left-6'
											: '-right-6'} scale-75 opacity-0 transition-all group-hover:opacity-100 hover:scale-100"
										onclick={() => handleDelete(comment.id)}
									>
										<Trash2 size={12} />
									</button>
								{/if} -->
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<div class="flex h-full flex-col items-center justify-center text-center opacity-20">
					<MessageSquare size={64} strokeWidth={1} class="mb-4" />
					<p class="text-lg font-medium">{m.comment_no_comments()}</p>
					<p class="text-sm">{m.comment_be_first()}</p>
				</div>
			{/if}
		</div>

		<!-- Input Area -->
		<fieldset class="bg-base-200/50 border-base-300 border-t p-4" disabled={isNetworkUnavailable}>
			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleSubmit();
				}}
				class="relative"
			>
				<textarea
					bind:value={newComment}
					class="textarea textarea-bordered focus:textarea-primary w-full resize-none py-3 pr-12 pl-4 text-sm transition-all"
					placeholder={m.comment_your_message_placeholder()}
					rows="2"
					onkeydown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							handleSubmit();
						}
					}}></textarea>
				<button
					type="submit"
					class="btn btn-primary btn-circle sm:btn-sm absolute right-3 bottom-3 shadow-lg"
				>
					{#if isSubmitting}
						<span class="loading loading-spinner loading-xs"></span>
					{:else}
						<Send size={16} />
					{/if}
				</button>
			</form>
		</fieldset>
	{:else}
		<div class="flex h-full flex-col items-center justify-center gap-3">
			<span class="loading loading-ring loading-lg text-primary"></span>
			<p class="text-base-content/40 animate-pulse text-sm">{m.common_loading()}</p>
		</div>
	{/if}
</div>

<style>
	/* Custom scrollbar */
	.overflow-y-auto::-webkit-scrollbar {
		width: 5px;
	}
	.overflow-y-auto::-webkit-scrollbar-thumb {
		background: hsl(var(--bc) / 0.2);
		border-radius: 10px;
	}
	.overflow-y-auto::-webkit-scrollbar-track {
		background: transparent;
	}
</style>
