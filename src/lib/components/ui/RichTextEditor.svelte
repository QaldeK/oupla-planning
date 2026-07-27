<script lang="ts">
import {
	Bold as BoldIcon,
	Heading2,
	Heading3,
	Italic as ItalicIcon,
	Link as LinkIcon,
	List,
	ListOrdered,
	Unlink
} from "@lucide/svelte";
import { Editor } from "@tiptap/core";
import Bold from "@tiptap/extension-bold";
import BulletList from "@tiptap/extension-bullet-list";
import Document from "@tiptap/extension-document";
import Heading from "@tiptap/extension-heading";
import Italic from "@tiptap/extension-italic";
import Link from "@tiptap/extension-link";
import ListItem from "@tiptap/extension-list-item";
import OrderedList from "@tiptap/extension-ordered-list";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { onDestroy, onMount } from "svelte";
import { toast } from "svelte-sonner";
import * as m from "$lib/paraglide/messages.js";

interface Props {
	/** HTML contenu. Bindable pour usage `bind:value`. */
	value?: string;
	placeholder?: string;
	disabled?: boolean;
	class?: string;
	/** Callback alternative au binding (utile pour notifications hors formulaire). */
	onchange?: (html: string) => void;
}

let {
	value = $bindable(""),
	placeholder = "",
	disabled = false,
	class: className = "",
	onchange
}: Props = $props();

let element = $state<HTMLDivElement>();
// Pattern officiel TipTap/Svelte 5 : on réassigne l'objet entier dans onTransaction
// pour forcer la réactivité (l'état interne de l'Editor n'est pas tracé par Svelte).
let editorState = $state<{ editor: Editor | null }>({ editor: null });

// Garde anti-boucle : empêche l'`$effect` de sync externe de redéclencher `onUpdate`.
let isSettingContent = false;

// TipTap renvoie `<p></p>` pour un contenu vide ; on normalise pour la comparaison.
function normalizeHtml(html: string): string {
	if (html === "<p></p>" || html === "<p><br></p>") return "";
	return html;
}

onMount(() => {
	if (!element) return;
	editorState.editor = new Editor({
		element,
		extensions: [
			Document,
			Text,
			Paragraph,
			Bold,
			Italic,
			Heading.configure({ levels: [2, 3] }),
			BulletList,
			ListItem,
			OrderedList,
			Link.configure({
				openOnClick: false,
				autolink: true,
				HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" }
			})
		],
		content: value || "",
		editable: !disabled,
		editorProps: {
			attributes: {
				class:
					"rich-text-content prose prose-sm max-w-none focus:outline-none min-h-[60px] px-3 py-2",
				"data-placeholder": placeholder
			}
		},
		onUpdate: ({ editor: e }) => {
			if (isSettingContent) return;
			const html = normalizeHtml(e.getHTML());
			value = html;
			onchange?.(html);
		},
		onTransaction: ({ editor }) => {
			editorState = { editor };
		}
	});
});

// Sync externe → interne : quand `value` change hors de l'éditeur (init, reset, sync realtime).
$effect(() => {
	void value;
	const e = editorState.editor;
	if (!e) return;
	const current = normalizeHtml(e.getHTML());
	if (current !== value) {
		isSettingContent = true;
		e.commands.setContent(value || "", { emitUpdate: false });
		isSettingContent = false;
	}
});

$effect(() => {
	editorState.editor?.setEditable(!disabled);
});

onDestroy(() => {
	editorState.editor?.destroy();
	editorState = { editor: null };
});

// Popover lien (rendu inline sous la toolbar).
let linkPopoverOpen = $state(false);
let linkUrl = $state("");

function openLinkPopover() {
	const e = editorState.editor;
	if (!e) return;
	const { from, to } = e.state.selection;
	if (from === to) {
		toast.warning(m.editor_link_toast());
		return;
	}
	const attrs = e.getAttributes("link");
	linkUrl = (attrs?.href as string) || "";
	linkPopoverOpen = true;
}

function applyLink() {
	const e = editorState.editor;
	if (!e) return;
	const url = linkUrl.trim();
	if (!url) {
		removeLink();
		return;
	}
	// Préfixer le protocole si manquant (ex: `example.com` → `https://example.com`).
	const normalized = /^https?:\/\//i.test(url) || /^mailto:/i.test(url) ? url : `https://${url}`;
	e.chain().focus().extendMarkRange("link").setLink({ href: normalized }).run();
	linkPopoverOpen = false;
}

function removeLink() {
	editorState.editor?.chain().focus().extendMarkRange("link").unsetLink().run();
	linkPopoverOpen = false;
}

// Boutons de la barre d'outils. Le `$derived.by` se re-déclenche à chaque transaction
// car `editorState` est réassigné dans `onTransaction` (cf. pattern officiel TipTap).
interface ToolbarButton {
	icon: typeof BoldIcon;
	label: string;
	active: boolean;
	run: () => void;
}

const toolbar: ToolbarButton[] = $derived.by(() => {
	const e = editorState.editor;
	if (!e) return [];
	return [
		{
			icon: BoldIcon,
			label: m.editor_bold_label(),
			active: e.isActive("bold"),
			run: () => e.chain().focus().toggleBold().run()
		},
		{
			icon: ItalicIcon,
			label: m.editor_italic_label(),
			active: e.isActive("italic"),
			run: () => e.chain().focus().toggleItalic().run()
		},
		{
			icon: Heading2,
			label: "Titre",
			active: e.isActive("heading", { level: 2 }),
			run: () => e.chain().focus().toggleHeading({ level: 2 }).run()
		},
		{
			icon: Heading3,
			label: "Sous-titre",
			active: e.isActive("heading", { level: 3 }),
			run: () => e.chain().focus().toggleHeading({ level: 3 }).run()
		},
		{
			icon: List,
			label: "Liste à puces",
			active: e.isActive("bulletList"),
			run: () => e.chain().focus().toggleBulletList().run()
		},
		{
			icon: ListOrdered,
			label: "Liste numérotée",
			active: e.isActive("orderedList"),
			run: () => e.chain().focus().toggleOrderedList().run()
		},
		{
			icon: LinkIcon,
			label: m.editor_link_label(),
			active: e.isActive("link"),
			run: openLinkPopover
		}
	];
});
</script>

<div
	class="rich-text-editor border-base-300 textarea-container rounded-box relative border {className}"
	aria-disabled={disabled || undefined}
>
	{#if toolbar.length > 0}
		<div
			class="border-base-300 flex flex-wrap items-center gap-0.5 border-b px-1 py-1"
			role="toolbar"
			aria-label="Mise en forme du texte"
		>
			{#each toolbar as btn (btn.label)}
				<button
					type="button"
					class="btn btn-ghost btn-sm"
					class:btn-active={btn.active}
					aria-pressed={btn.active}
					aria-label={btn.label}
					title={btn.label}
					onclick={btn.run}
					{disabled}
					tabindex={linkPopoverOpen ? -1 : 0}
				>
					<btn.icon size={16} />
				</button>
			{/each}

			{#if editorState.editor?.isActive('link')}
				<button
					type="button"
					class="btn btn-ghost btn-sm"
					aria-label="Retirer le lien"
					title="Retirer le lien"
					onclick={removeLink}
					{disabled}
				>
					<Unlink size={16} />
				</button>
			{/if}
		</div>
	{/if}

	{#if linkPopoverOpen}
		<div class="border-base-300 bg-base-100 flex items-center gap-2 border-b px-2 py-2">
			<input
				bind:value={linkUrl}
				type="url"
				placeholder="https://exemple.com"
				class="input input-sm min-w-0 flex-1"
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						applyLink();
					} else if (e.key === 'Escape') {
						linkPopoverOpen = false;
					}
				}}
				aria-label="URL du lien"
			/>
			<button type="button" class="btn btn-primary btn-sm" onclick={applyLink}>Appliquer</button>
			<button type="button" class="btn btn-ghost btn-sm" onclick={() => (linkPopoverOpen = false)}>
				Annuler
			</button>
		</div>
	{/if}

	<div bind:this={element} class="rich-text-editor-surface"></div>
</div>

<style>
	/* Le contenu est rendu par TipTap à l'intérieur de .rich-text-editor-surface.
	   Les styles de typographie (.rich-text-content) vivent dans app.css pour être
	   partagés avec DescriptionCard. */
	.textarea-container :global(.ProseMirror) {
		min-height: 60px;
	}
	.textarea-container :global(.ProseMirror:focus) {
		outline: none;
	}
	.textarea-container[aria-disabled='true'] {
		opacity: 0.6;
		pointer-events: none;
	}
</style>
