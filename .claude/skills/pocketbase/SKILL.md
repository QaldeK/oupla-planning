---
name: pocketbase
description: Comprehensive guide for PocketBase backend development with focus on API rules/permissions and JavaScript event hooks. Use when working with PocketBase collections, setting up access control, implementing server-side hooks, or debugging permission/hook issues in PocketBase applications.
---

# PocketBase Development Skill

Guide for working with PocketBase as a backend, with specialized focus on the two most error-prone areas: API Rules (permissions) and JavaScript Event Hooks.

## Core Workflow

1. **Define schema** - Create collections with appropriate fields
2. **Set API rules** - Configure permissions (listRule, viewRule, createRule, updateRule, deleteRule)
3. **Implement hooks** - Add server-side logic in `pb_hooks/` directory
4. **Test thoroughly** - Verify permissions and hooks trigger correctly

## Production Security (CRITICAL)

**⚠️ These are ESSENTIAL for production deployments - not optional:**

### 1. Encrypt Settings

By default, PocketBase stores SMTP passwords and S3 credentials as **PLAIN TEXT** in the database.

- Enable encryption: Settings > Application > "Encrypt settings"
- Do this BEFORE entering production credentials

### 2. Enable Rate Limiting

PocketBase v0.23+ includes built-in rate limiting to prevent abuse and DoS attacks.

- Configure: Dashboard > Settings > Application
- Prevents excessive auth requests, record creation spam
- Can use reverse proxy rate limiting for advanced needs

### 3. Protect Admin Endpoints

Use reverse proxy (nginx/caddy) to whitelist IPs for `/api/admins/*` endpoints.

### 4. Enable Superuser MFA

Add MFA to `_superusers` collection for additional security layer.

- Requires one-time password (email code) for superuser auth
- Settings > Collections > \_superusers > Options

### 5. Use HTTPS

PocketBase supports auto-managed TLS with Let's Encrypt:

```bash
./pocketbase serve --https example.com:443
```

Or use reverse proxy (nginx, caddy) for more complex setups.

### 6. Regular Backups

Backup entire `pb_data` directory regularly (see references/production_checklist.md).

**Never expose PocketBase directly to internet without these protections!**

## API Rules (Permissions)

### Critical Concepts

**Rules act as BOTH authorization AND filters:**

- Empty string `""` = locked (superuser only)
- `null` = public access (no restrictions)
- Non-empty expression = conditional access

**Return codes based on rule type:**

- Unsatisfied `listRule` → 200 with empty array
- Unsatisfied `createRule` → 400
- Unsatisfied `viewRule`, `updateRule`, `deleteRule` → 404
- Locked rule with non-superuser → 403

**Superusers bypass ALL rules** - use test accounts for rule validation

### Common Permission Patterns

See [references/permission_patterns.md](references/permission_patterns.md) for detailed examples.

**Key points:**

- Use `@request.auth.id != ""` to require authentication
- Use `@request.auth.id = id` for owner-only access
- Use `@request.body.fieldName` to validate submitted data
- Use `:isset` modifier to check if field was submitted
- Use `:length` modifier for array field item counts
- Chain conditions with `&&` (AND) and `||` (OR)

### Permission Debugging

When permissions fail unexpectedly:

1. Check if testing as superuser (rules are bypassed!)
2. Verify `@request.auth` is populated (user is authenticated)
3. Test rule expression in isolation
4. Check for typos in field names
5. Remember: `@request.body.*` for submitted data, not `@request.data.*` (renamed in v0.23+)

## JavaScript Event Hooks

### Critical Concepts

**Hook files:**

- Create `*.pb.js` files in `pb_hooks/` directory
- Files auto-reload on save (Unix systems only)
- Use `/// <reference path="../pb_data/types.d.ts" />` for typing

**Hook execution chain:**

- ALL handlers must call `e.next()` to continue chain
- Throwing error OR not calling `e.next()` stops execution
- Hooks share signature: `function(e) {}`

### Hook Categories & Timing

See [references/hook_guide.md](references/hook_guide.md) for comprehensive hook reference.

**Model hooks vs Request hooks:**

- **Model hooks** (`onRecordCreate`, etc.) - No request context, triggered by ANY save/delete (API, hooks, console)
- **Request hooks** (`onRecordCreateRequest`, etc.) - Have request context, only trigger from API calls

**Hook timing for operations:**

```
BEFORE e.next() → before validation & DB operation
AFTER e.next() → after validation & DB operation (may not be persisted yet)
*AfterSuccess → after confirmed DB persistence
*AfterError → after DB operation failure
```

### Common Hook Pitfalls

**Problem: Hook doesn't trigger**

- Using wrong hook type (Request vs Model)
- Collection name filter is case-sensitive and must match exactly
- Hook file not saved as `*.pb.js`
- Syntax error preventing hook registration

**Problem: Infinite recursion**

- Calling `$app.save()` inside update hook without preventing re-trigger
- **JavaScript Solution**: Use conditional guards to prevent re-execution
- **Use `e.app` instead of `$app`** to avoid recursion in nested operations
- **Use transactions** to modify records without triggering their hooks
- **NEVER use `$app.unsafeWithoutHooks()`** - bypasses ALL validations including system checks
- Better approach: Check if processing already done before modifying

```javascript
// ❌ DANGEROUS - Bypasses system validations
onRecordUpdate((e) => {
	e.next();
	$app.unsafeWithoutHooks().save(e.record); // UNSAFE!
}, 'tasks');

// ✅ CORRECT - Use conditional guard
onRecordUpdate((e) => {
	if (e.record.get('processed') === true) {
		e.next();
		return;
	}
	e.record.set('processed', true);
	e.next();
}, 'tasks');

// ✅ BEST - Use transaction to avoid triggering hooks (v0.36+)
onRecordAfterUpdateSuccess((e) => {
	$app.runInTransaction((txApp) => {
		const related = txApp.findRecordById('other', e.record.get('relatedId'));
		related.set('count', related.get('count') + 1);
		txApp.save(related); // Won't trigger 'other' hooks
	});
	e.next();
}, 'tasks');
```

**Problem: Changes in hook not reflected**

- Modifying record AFTER `e.next()` in Request hooks won't affect response
- Solution: Make changes BEFORE `e.next()` or use Model hooks

**Problem: Cascading hooks don't fire**

- When updating Record A inside Record B's hook, Record A's hooks don't trigger
- Solution: Use `e.dao.saveRecord()` (not `e.dao.withoutHooks()`) if you want cascading

### Hook Patterns

See [references/api_reference.md](references/api_reference.md) for specific examples.

**Common patterns:**

- Auto-populate fields on create
- Validate complex business logic
- Send notifications on changes
- Update related records
- Prevent certain field modifications

## Accessing Record Data

**In hooks:**

```javascript
// Get current value
const value = e.record.get('fieldName');

// Set value
e.record.set('fieldName', newValue);

// Get original (before changes)
const original = e.record.originalCopy();

// Parse to plain object for comparison
const parsed = JSON.parse(JSON.stringify(e.record));
```

**In API rules:**

```
// Current record field
fieldName = "value"

// Submitted request data
@request.body.fieldName = "value"

// Auth user field
@request.auth.fieldName = "value"

// Related record via relation field
relationField.otherField = "value"
```

## Realtime Subscriptions & Security

### How Realtime Respects API Rules

**Critical understanding**: Realtime subscriptions enforce API rules automatically.

- **Single record subscription** → Uses collection's `viewRule`
- **Collection subscription** → Uses collection's `listRule`

```javascript
// Client subscribes to collection
pb.collection('posts').subscribe('*', (data) => {
	console.log(data.action, data.record);
});
// User only receives events for records they can LIST per listRule
```

### No Client-Side Filtering

**Important**: You CANNOT filter subscriptions client-side for security.

```javascript
// ❌ This filter parameter is IGNORED by PocketBase
pb.collection('posts').subscribe('*', {
    filter: 'status="draft"'  // Does nothing!
})

// ✅ Filter via API rules instead
// In collection's listRule:
status = "published" || @request.auth.id = author
```

### Security Implications

- Users only receive realtime events for records matching their `listRule`/`viewRule`
- Records becoming inaccessible don't emit "removed" events (performance)
- Check `@request.context = "realtime"` in rules if you need realtime-specific logic
- Realtime is secure by default - respects same permissions as REST API

## File Structure

```
project/
├── pb_hooks/
│   ├── main.pb.js          # Primary hooks
│   └── additional.pb.js    # Split by domain if needed
├── pb_data/
│   ├── data.db             # SQLite database
│   └── types.d.ts          # TypeScript definitions (auto-generated)
└── pocketbase              # Executable
```

## Additional Resources

- [references/permission_patterns.md](references/permission_patterns.md) - Common permission rules
- [references/hook_guide.md](references/hook_guide.md) - Complete hook reference
- [references/api_reference.md](references/api_reference.md) - Core API methods
