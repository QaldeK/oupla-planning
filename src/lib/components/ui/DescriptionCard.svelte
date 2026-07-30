<script lang="ts">
import { Drawer, DrawerContent, DrawerHandle, DrawerOverlay } from "@abhivarde/svelte-drawer";
import { ChevronDown, ChevronUp, X } from "@lucide/svelte";
import DOMPurify from "dompurify";
import * as m from "$lib/paraglide/messages.js";
import { mediaQuery } from "$lib/stores/mediaQuery.svelte";

interface Props {
	/** Texte à afficher. Vide → le composant ne rend rien. */
	text: string;
	/** Nombre de lignes visibles en mode replié. */
	collapsedLines?: number;
	class?: string;
}

let { text, collapsedLines = 1, class: className = "" }: Props = $props();

// Détection HTML : une description issue du RichTextEditor contiendra des balises
// connues ; une description legacy en texte brut (ou sans balises valides) reste
// rendue en whitespace-pre-line pour préserver les sauts de ligne existants.
const HTML_TAG_RE = /<(?:\/?)(?:p|br|strong|em|ul|ol|li|a|h1|h2|h3|h4|h5|h6|b|i)\b[^>]*>/i;
const ALLOWED_TAGS = ["p", "br", "strong", "em", "ul", "ol", "li", "a", "h2", "h3"];
const ALLOWED_ATTR = ["href", "target", "rel"];

const isHtml = $derived(HTML_TAG_RE.test(text || ""));
const sanitizedHtml = $derived(
	isHtml
		? DOMPurify.sanitize(text, {
				ALLOWED_TAGS,
				ALLOWED_ATTR,
				ALLOW_DATA_ATTR: false
			})
		: ""
);

let isExpanded = $state(false);
let isDrawerOpen = $state(false);
let isClippable = $state(false);
let contentEl = $state<HTMLElement>();

// Style line-clamp appliqué uniquement en mode replié. Style inline car
// collapsedLines est dynamique (les utilitaires line-clamp-N ne conviennent pas).
const clampStyle = $derived(
	isExpanded
		? ""
		: `display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;-webkit-line-clamp:${collapsedLines};`
);

function measure() {
	const el = contentEl;
	// Mesurer uniquement en mode replié : en mode déplié scrollHeight ≈ clientHeight,
	// ce qui masquerait à tort l'indicateur « Réduire ».
	if (!el || isExpanded) return;
	isClippable = el.scrollHeight - el.clientHeight > 1;
}

// Détecte la capacité de repli via ResizeObserver (texte, largeur, police…).
function clampMeasurable(node: HTMLElement) {
	contentEl = node;
	measure();
	const ro = new ResizeObserver(() => measure());
	ro.observe(node);
	return {
		destroy() {
			ro.disconnect();
			contentEl = undefined;
		}
	};
}

// Réinitialiser l'état déplié quand le contenu change (occurrence suivante,
// édition, sync realtime).
$effect(() => {
	void text;
	void collapsedLines;
	isExpanded = false;
});

// Au repli, re-mesurer une fois le clamp ré-appliqué.
$effect(() => {
	if (!isExpanded) queueMicrotask(measure);
});

function toggle() {
	if (mediaQuery.isMobile) {
		isDrawerOpen = true;
	} else {
		isExpanded = !isExpanded;
	}
}
</script>

{#if text}
  {#snippet body()}
    <span class="relative flex items-start gap-2">
      <span
        class="text-base-content/80 min-w-0 flex-1 text-sm {isHtml
          ? 'rich-text-content'
          : 'whitespace-pre-line'}"
        style={clampStyle}
        use:clampMeasurable
      >
        {#if isHtml}{@html sanitizedHtml}{:else}{text}{/if}
      </span>
      {#if isClippable}
        <span
          class="text-primary-content badge badge-soft badge-primary absolute right-0 -bottom-1 inline-flex shrink-0 items-center gap-0.5 text-sm font-bold opacity-90"
        >
          {#if !mediaQuery.isMobile}
            {#if !isExpanded}{m.description_read_more()}
              <ChevronDown size={16} />{:else}{m.description_collapse()}
              <ChevronUp size={16} />{/if}
          {/if}
        </span>
      {/if}
    </span>
  {/snippet}

  {#if isClippable}
    <button
      type="button"
      class="border-neutral/20 bg-base-300/60 hover:bg-base-300/80 w-full cursor-pointer border-0 border-s-4 px-3 py-2 text-left transition-colors {className}"
      aria-expanded={isExpanded}
      aria-label={mediaQuery.isMobile
        ? m.description_aria_open()
        : isExpanded
          ? m.description_aria_collapse()
          : m.description_aria_expand()}
      onclick={toggle}
    >
      {@render body()}
    </button>
  {:else}
    <div
      class="border-neutral/20 bg-base-300/60 border-s-4 px-3 py-2 {className}"
    >
      {@render body()}
    </div>
  {/if}
{/if}

{#if isDrawerOpen}
  <Drawer
    bind:open={isDrawerOpen}
    portal={true}
    direction="bottom"
    closeOnEscape={true}
  >
    <DrawerOverlay class="fixed inset-0 z-50 bg-black/40" />
    <DrawerContent
      class="bg-base-100 fixed inset-x-0 bottom-0 z-50 flex max-h-[50dvh] w-dvw flex-col rounded-t-lg shadow-2xl"
    >
      <DrawerHandle class="bg-base-content/30 mt-2 mb-1" />
      <div
        class="border-base-300 flex items-center justify-between border-b px-4 py-3"
      >
        <h3 class="text-base font-semibold">
          {m.planform_description_label()}
        </h3>
        <button
          type="button"
          class="btn btn-circle btn-ghost btn-sm"
          onclick={() => (isDrawerOpen = false)}
          aria-label={m.common_close()}
        >
          <X size={20} />
        </button>
      </div>
      <div class="flex-1 overflow-y-auto p-4">
        {#if isHtml}
          <div class="rich-text-content text-base-content/80 text-sm">
            {@html sanitizedHtml}
          </div>
        {:else}
          <p class="text-base-content/80 text-sm whitespace-pre-line">{text}</p>
        {/if}
      </div>
    </DrawerContent>
  </Drawer>
{/if}
