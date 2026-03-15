<script lang="ts">
	import { drawerStore } from '$lib/stores/drawerStore.svelte';
	import { userStore } from '$lib/stores/userStore.svelte';
	import { addComment, deleteComment } from '$lib/services/planningActions';
	import { formatDate } from '$lib/utils/date';
	import { MessageSquare, Trash2, Send, X } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';

	const occurrence = $derived(drawerStore.data?.occurrence);
	const master = $derived(drawerStore.data?.master);
	const currentUserId = $derived(drawerStore.data?.currentUserId);
	const isAdmin = $derived(drawerStore.data?.isAdmin ?? false);
	const token = $derived(master?.participantToken || master?.adminToken);

	let newComment = $state('');
	let isSubmitting = $state(false);
	let scrollContainer: HTMLDivElement | undefined = $state();

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
						behavior: 'smooth'
					});
				}
			}, 50);
		}
	});

	async function handleSubmit() {
		if (!newComment.trim() || !occurrence || !master || !currentUserId || !token) return;

		isSubmitting = true;
		try {
			await addComment(occurrence.id, currentUserId, newComment.trim(), token, occurrence);
			newComment = '';
		} catch (error) {
			console.error('Error adding comment:', error);
			toast.error("Erreur lors de l'ajout du commentaire");
		} finally {
			isSubmitting = false;
		}
	}

	async function handleDelete(commentId: string) {
		if (!occurrence || !master || !token) return;
		try {
			await deleteComment(occurrence.id, commentId, token, occurrence);
			toast.success('Commentaire supprimé');
		} catch (error) {
			console.error('Error deleting comment:', error);
			toast.error('Erreur lors de la suppression');
		}
	}
</script>

<div class="bg-base-100 flex h-full flex-col">
	{#if occurrence}
		<!-- Header -->
		<div class="border-base-300 flex items-center justify-between border-b px-4 py-3">
			<div class="flex items-center gap-2">
				<div class="bg-primary/10 flex h-8 w-8 items-center justify-center rounded-lg">
					<MessageSquare size={18} class="text-primary" />
				</div>
				<div>
					<h4 class="text-sm leading-none font-bold">Commentaires</h4>
					<p class="text-base-content/50 mt-1 text-xs">
						{occurrence.comments.length} message{occurrence.comments.length > 1 ? 's' : ''}
					</p>
				</div>
			</div>
			<button
				class="btn btn-ghost sm:btn-sm btn-circle"
				onclick={() => drawerStore.close()}
				aria-label="Fermer"
			>
				<X size={20} />
			</button>
		</div>

		<div bind:this={scrollContainer} class="flex-1 overflow-y-auto p-4">
			{#if occurrence.comments.length > 0}
				<div class="flex flex-col gap-4">
					{#each occurrence.comments as comment (comment.id)}
						{@const isCurrentUser = comment.participantId === currentUserId}
						<div class="chat {isCurrentUser ? 'chat-end' : 'chat-start'} group">
							<div class="chat-header mb-1 text-[11px] font-medium opacity-50">
								{getParticipantName(comment.participantId)}
								<time class="ml-1 font-normal"
									>{formatDate(comment.createdAt, 'd MMM à HH:mm')}</time
								>
							</div>
							<div
								class="chat-bubble relative min-h-0 text-sm shadow-sm {isCurrentUser
									? 'bg-primary/20'
									: 'bg-base-300 text-base-content'}"
							>
								<p class="leading-relaxed whitespace-pre-wrap">{comment.content}</p>
								{#if isCurrentUser || isAdmin}
									<button
										class="btn btn-circle btn-error btn-outline btn-xs absolute -top-2 {isCurrentUser
											? '-left-6'
											: '-right-6'} scale-75 opacity-0 transition-all group-hover:opacity-100 hover:scale-100"
										onclick={() => handleDelete(comment.id)}
									>
										<Trash2 size={12} />
									</button>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<div class="flex h-full flex-col items-center justify-center text-center opacity-20">
					<MessageSquare size={64} strokeWidth={1} class="mb-4" />
					<p class="text-lg font-medium">Aucun commentaire</p>
					<p class="text-sm">Soyez le premier à réagir !</p>
				</div>
			{/if}
		</div>

		<!-- Input Area -->
		<div class="bg-base-200/50 border-base-300 border-t p-4">
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
					placeholder="Votre message..."
					rows="2"
					disabled={isSubmitting}
					onkeydown={(e) => {
						if (e.key === 'Enter' && !e.shiftKey) {
							e.preventDefault();
							handleSubmit();
						}
					}}
				></textarea>
				<button
					type="submit"
					class="btn btn-primary btn-circle sm:btn-sm absolute right-3 bottom-3 shadow-lg"
					disabled={!newComment.trim() || isSubmitting}
				>
					{#if isSubmitting}
						<span class="loading loading-spinner loading-xs"></span>
					{:else}
						<Send size={16} />
					{/if}
				</button>
			</form>
		</div>
	{:else}
		<div class="flex h-full flex-col items-center justify-center gap-3">
			<span class="loading loading-ring loading-lg text-primary"></span>
			<p class="text-base-content/40 animate-pulse text-sm">Chargement...</p>
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
