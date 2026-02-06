# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development

- `bun run dev` - Start development server with Vite
- `bun run dev -- --open` - Start dev server and open in browser

### Build & Deploy

- `bun run build` - Build for production (Cloudflare Workers)
- `bun run preview` - Preview production build locally on port 4173 (via Wrangler)
- `bun run gen` - Generate Wrangler types for Cloudflare bindings

### Code Quality

- `bun run check` - Type checking with svelte-check
- `bun run check:watch` - Type checking in watch mode
- `bun run lint` - Run ESLint and Prettier checks
- `bun run format` - Format code with Prettier

**⚠️ RÈGLES DE DÉVELOPPEMENT CRITIQUES :**

- **Svelte 5** : Préférer `$derived` au tag `{@const}` quand la valeur est utilisée dans plusieurs blocs ou à la racine d'un composant. `{@const}` ne peut être qu'un enfant direct de blocs spécifiques (`{#if}`, `{#each}`, etc.).
- **DaisyUI 5** : Respecter scrupuleusement les patterns de composants du projet. Ne pas utiliser `form-control`. Utiliser les labels englobants pour les inputs : `<label class="input"><span>...</span><input /></label>`.
- **Validation** : Après chaque refactorisation importante, exécuter `bun run check` et `bun run lint` (ou utiliser les outils d'auto-fix disponibles) pour valider la syntaxe.

## Interaction Mode: Questions vs Implementation

**⚠️ IMPORTANT: Distinguer les questions des demandes d'implémentation**

### Quand l'utilisateur pose des questions :

Si l'utilisateur **pose une question** (format interrogatif, "comment", "pourquoi", "que se passe-t-il", "explique-moi", etc.) :

- ✅ Répondre à la question de manière complète et précise
- ✅ Envisager et proposer des solutions aux problèmes posés
- ✅ Expliquer les options et leurs implications
- ❌ **NE PAS** modifier le code
- ❌ **NE PAS** créer de fichiers
- ❌ **NE PAS** lancer de commandes de build/test/déploiement

**Exemples de questions** (mode lecture seule) :

- "Comment fonctionne X dans ce code ?"
- "Pourquoi ça fait ça ?"
- "Que se passe-t-il si je change ce paramètre ?"
- "Explique-moi l'architecture de Y"
- "C'est normal que... ?"
- "Comment tu ferais pour... ?"

### Quand l'utilisateur demande une implémentation :

Si l'utilisateur **demande une action** (impératif, "ajoute", "modifie", "crée", "corrige", "implémente", etc.) :

- ✅ Analyser la demande et proposer un plan si nécessaire
- ✅ Implémenter les modifications demandées
- ✅ Suivre les patterns architecturaux du projet

**Exemples de demandes d'implémentation** (mode action) :

- "Ajoute une fonction qui..."
- "Modifie le composant X pour..."
- "Crée un nouveau fichier..."
- "Corrige ce bug..."
- "Refactorise cette partie..."

**En cas de doute** : demander une clarification à l'utilisateur avant d'agir sur le code.

## Project Architecture

This is a SvelteKit 2 application for event planning and attendance management, deployed on Cloudflare Workers with PocketBase as backend.

### Tech Stack

- **Frontend**: Svelte 5 with runes, SvelteKit 2, TypeScript
- **Backend**: PocketBase (embedded in `pocketbase/` directory)
- **Deployment**: Cloudflare Workers (via `@sveltejs/adapter-cloudflare`)
- **Styling**: Tailwind CSS 4 + DaisyUI components
- **State**: Svelte 5 runes (`$state`, `$derived`) and a custom UserStore for localStorage
- **Package Manager**: Bun (use `bun` commands instead of `npm`)

### Authentication Model

The app uses a **token-based authentication system** with two token types per planning:

- `adminToken` (64 chars hex) - Full access to planning management
- `participantToken` (32 chars hex) - Participant access (responses, comments)

**Token transmission**: Tokens are passed via query parameter `_token` in all API requests (NOT via headers).

**Why query params?** The PocketBase JS SDK doesn't reliably transmit custom headers for GET requests. Query params work consistently across all operations.

**Backend validation**: Tokens are validated in PocketBase hooks (`pocketbase/pb_hooks/main.pb.js`):

- Each hook must have a unique identifier (e.g., `'planningOccurrencesView'`)
- Without identifier, hooks apply globally to ALL collections (blocking admin access)
- Admin users bypass token validation via `e.admin` check

### Key Collections (PocketBase)

1. **planning_masters** - Main planning entity with recurrence configuration, participants list, tokens
2. **planning_occurrences** - Individual event instances with responses and comments

Relation: `planning_occurrences.master` → `planning_masters.id`

### Important Architectural Patterns

#### Service Layer Pattern

All database operations go through `src/lib/services/planningActions.ts`. Never call PocketBase directly from components.

#### PocketBase Hooks

Server-side security is enforced in `pocketbase/pb_hooks/main.pb.js`:

- Tokens are generated client-side (see `planningActions.ts`)
- Token validation via query parameter `_token` (NOT headers)
- List operations filter by token automatically
- Participants can only modify `responses` field in occurrences
- Admin token required for master/occurrence CRUD

**⚠️ CRITICAL: Hook Identifiers**
Every hook MUST have a unique identifier as the last parameter:

```javascript
// ✅ CORRECT - Hook with unique identifier
onRecordViewRequest((e) => {
	if (e.collection.name !== 'planning_occurrences') {
		return e.next();
	}
	// ... validation logic ...
	e.next();
}, 'planningOccurrencesView'); // ← REQUIRED!

// ❌ WRONG - Hook without identifier
onRecordViewRequest((e) => {
	// ... logic ...
	e.next();
}); // ← Missing identifier! Applies to ALL collections!
```

**Why identifiers matter:**

- Without identifier, PocketBase can't distinguish between hooks
- The hook applies globally to ALL collections, blocking even admin operations
- With identifier, the hook is scoped to its specific collection only
- Identifiers can be arbitrary names but must be unique per hook type

Server-side security is enforced in `pocketbase/pb_hooks/main.pb.js`:

- Tokens are auto-generated on record creation
- List operations filter by token automatically
- Participants can only modify `responses` field in occurrences
- Admin token required for master/occurrence CRUD

#### Recurrence System

Complex recurrence logic in `src/lib/utils/recurrence.ts`:

- Types: WEEKLY, BIWEEKLY, MONTHLY_BY_DATE, MONTHLY_BY_DAY
- `generateRecurrenceDates()` - Generates occurrence dates from config
- `getRecurrenceLabel()` - Human-readable French labels

#### User Management

`src/lib/stores/userStore.svelte.ts` manages:

- Current user identification (localStorage)
- Saved plannings history
- User preferences (notifications)

#### Realtime Sync

The app uses **PocketBase Realtime (SSE)** for live updates across all connected users:

- **Service**: `src/lib/services/realtime.svelte.ts` - Class-based store with Svelte 5 runes
- **Security**: Server-side validation via `onRealtimeSubscribeRequest` hook
- **Pattern**: Subscribe in `onMount`, unsubscribe in `onDestroy`
- **Merge strategy**: Optimistic locking with refetch-before-update (`submitResponseSafe`)

**⚠️ CRITICAL: Realtime Security**
All realtime subscriptions MUST be validated server-side in `pocketbase/pb_hooks/main.pb.js`:

- Client-side filtering is NOT secure (easily bypassed)
- Use `onRealtimeSubscribeRequest` hook to validate tokens
- Query params are used for both filtering AND authentication
- Reject invalid/missing tokens with 401/403 before establishing connection

**See `agent/docs_project/realtime-architecture.md` for detailed implementation guide.**

### Route Structure

- `/` - Landing page
- `/new` - Create new planning
- `/p/[token]` - Participant view (auto-redirects admin tokens to `/admin/[token]`)
- `/admin/[token]` - Admin view with full CRUD

### Vite Inspector

Press `Alt-X` to toggle the Svelte inspector for component debugging.

## Svelte MCP Server

You have access to comprehensive Svelte 5 and SvelteKit documentation via MCP tools:

### 1. list-sections

Use FIRST to discover available documentation sections.

### 2. get-documentation

After list-sections, fetch ALL relevant documentation sections for the task.

### 3. svelte-autofixer

MUST use this tool whenever writing Svelte code before sending to user.

### 4. playground-link

Only call after user confirmation and NEVER for code written to project files.

## PocketBase Skills

⚠️ **CRITICAL**: When working with PocketBase, ALWAYS consult the documentation first. PocketBase APIs change frequently and using incorrect or invented methods will cause runtime errors.

**Before writing ANY PocketBase code:**

1. Read `.claude/skills/pocketbase/references/hook_guide.md` for hook patterns
2. Read `.claude/skills/pocketbase/references/permission_patterns.md` for API rules
3. Check existing code in `pocketbase/pb_hooks/main.pb.js` for working examples

This project uses PocketBase. Relevant documentation is in `.claude/skills/pocketbase/`:

- **Permissions/API Rules**: `.claude/skills/pocketbase/references/permission_patterns.md`
- **Hooks**: `.claude/skills/pocketbase/references/hook_guide.md`
- **Production deployment**: `.claude/skills/pocketbase/references/production_checklist.md`

**Important PocketBase Concepts:**

- Rules act as both authorization AND filters
- Test permissions as non-admin users
- Hook timing: before vs after e.next()
- NEVER guess API methods - always verify in documentation or existing working code

## File Operations Rules

### Deletion Safety

- **NEVER use `rm -rf`** - blocked by command-validator hook
- Use `trash` instead: `trash folder-name` or `trash file.txt`

## UI Components - daisyUI Guidelines

⚠️ **CRITICAL**: When working with forms and UI components, ALWAYS consult the daisyUI documentation first. daisyUI 5 has changed class names from previous versions.

**Before writing ANY form or UI component code:**

1. Read `agent/docs_stack/daisyui_documentation.md` for the complete daisyUI 5 component reference
2. Verify that the classes you're using exist in daisyUI 5 (many class names changed from v4)
3. Check existing components in `src/lib/components/` for working examples

**Common mistakes to avoid:**

- Don't use v4 class names that were removed in v5
- Don't invent custom class combinations - use documented patterns
- For forms: always reference the form-related components (input, select, checkbox, radio, textarea, etc.) from the documentation

**Documentation location:** `agent/docs_stack/daisyui_documentation.md`
