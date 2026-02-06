# PocketBase Hook Guide

Complete reference for JavaScript event hooks in PocketBase.

## Table of Contents

1. [Hook Basics](#hook-basics)
2. [Hook Lifecycle](#hook-lifecycle)
3. [Record Hooks](#record-hooks)
4. [Request Hooks](#request-hooks)
5. [Choosing the Right Hook](#choosing-the-right-hook)

## Hook Basics

### File Setup

```javascript
/// <reference path="../pb_data/types.d.ts" />

// All hooks must call e.next() to continue the chain
onRecordCreate((e) => {
	// Your code here
	e.next();
}, 'collectionName');
```

### Hook Signature

All hooks share the same signature:

```javascript
function(e) {
    // e.app - PocketBase app instance (préférable à $app dans les hooks pour éviter les boucles infinies)
    // e.next() - Continue execution chain (REQUIRED)
    // Additional fields vary by hook type
}
```

**⚠️ IMPORTANT: Utilisez `e.app` au lieu de `$app` dans les hooks**

Dans les hooks, utilisez toujours `e.app.findRecordById()` au lieu de `$app.findRecordById()` pour éviter les boucles infinies :

```javascript
// ✅ CORRECT - Utilise e.app
onRecordUpdate((e) => {
	const related = e.app.findRecordById('other', e.record.get('otherId'));
	related.set('count', related.get('count') + 1);
	e.app.save(related);
	e.next();
}, 'main');

// ❌ À ÉVITER - Peut provoquer des boucles infinies
onRecordUpdate((e) => {
	const related = $app.findRecordById('other', e.record.get('otherId'));
	related.set('count', related.get('count') + 1);
	$app.save(related);
	e.next();
}, 'main');
```

### Collection Filtering

```javascript
// Fires for ALL collections
onRecordCreate((e) => {
	e.next();
});

// Fires only for specific collections
onRecordCreate(
	(e) => {
		e.next();
	},
	'users',
	'articles'
);
```

## Hook Lifecycle

### Model Hook Execution Order (e.g., Create)

```
1. onRecordCreate (before e.next())
2. onRecordValidate
3. onRecordCreateExecute
4. Database INSERT
5. onRecordCreate (after e.next())
6. onRecordAfterCreateSuccess OR onRecordAfterCreateError
```

### Request Hook Execution

```
1. onRecordCreateRequest (before e.next())
2. Request validation
3. Model hooks triggered (see above)
4. onRecordCreateRequest (after e.next())
5. Response sent to client
```

### When Hooks Fire

- **Model hooks** - Fired on ANY record modification (API, console, other hooks, migrations)
- **Request hooks** - Fired ONLY when the corresponding API endpoint is called
- **Before e.next()** - Before validation and DB operation
- **After e.next()** - After validation and DB operation (may not be committed)
- **\*AfterSuccess** - After confirmed DB persistence (transaction committed)
- **\*AfterError** - After DB operation failure or transaction rollback

## Record Hooks

### Model Hooks (No Request Context)

#### onRecordValidate

```javascript
onRecordValidate((e) => {
	// e.app
	// e.record

	// Add custom validation
	if (e.record.get('age') < 18) {
		throw new Error('Must be 18 or older');
	}

	e.next();
}, 'users');
```

- Triggered by `$app.validate()` or `$app.save()`
- Use for custom validation logic

#### onRecordCreate

```javascript
onRecordCreate((e) => {
	// e.app
	// e.record

	// Auto-populate fields BEFORE e.next()
	e.record.set('createdBy', 'system');

	e.next();

	// Access saved record AFTER e.next()
	console.log('Created record ID:', e.record.id);
}, 'articles');
```

- Fires when creating new records
- Before `e.next()`: before validation/insert
- After `e.next()`: after validation/insert but may not be committed

#### onRecordCreateExecute

```javascript
onRecordCreateExecute((e) => {
	// e.app
	// e.record (validated, about to be inserted)

	// Last chance modifications before DB insert
	e.record.set('internalId', generateUniqueId());

	e.next();
}, 'orders');
```

- Fires after validation, before DB INSERT
- Record is already validated

#### onRecordAfterCreateSuccess

```javascript
onRecordAfterCreateSuccess((e) => {
	// e.app
	// e.record (successfully persisted)

	// Send notification after confirmed creation
	sendWelcomeEmail(e.record.get('email'));

	e.next();
}, 'users');
```

- Fires after successful DB persistence
- Transaction is committed
- Safe for external API calls, emails, etc.

#### onRecordAfterCreateError

```javascript
onRecordAfterCreateError((e) => {
	// e.app
	// e.record
	// e.error

	console.error('Failed to create record:', e.error);

	e.next();
}, 'users');
```

- Fires on creation failure
- Can happen immediately or delayed (transaction rollback)

#### onRecordUpdate, onRecordUpdateExecute, onRecordAfterUpdateSuccess, onRecordAfterUpdateError

Same pattern as Create hooks, but for updates:

```javascript
onRecordUpdate((e) => {
	// Compare with original
	const original = e.record.originalCopy();
	const oldStatus = original.get('status');
	const newStatus = e.record.get('status');

	if (oldStatus !== newStatus) {
		// Status changed
		e.record.set('statusChangedAt', new Date());
	}

	e.next();
}, 'tasks');
```

#### onRecordDelete, onRecordDeleteExecute, onRecordAfterDeleteSuccess, onRecordAfterDeleteError

Same pattern as Create hooks, but for deletions:

```javascript
onRecordDelete((e) => {
	// Soft delete instead
	e.record.set('deleted', true);
	$app.save(e.record);

	// Don't call e.next() to prevent actual deletion
}, 'important_data');
```

#### onRecordEnrich

```javascript
onRecordEnrich((e) => {
	// e.app
	// e.record
	// e.requestInfo (null for non-request contexts)

	// Hide sensitive fields
	e.record.hide('internalNotes');

	// Add computed fields (requires withCustomData)
	if (e.requestInfo?.auth) {
		e.record.withCustomData(true);
		e.record.set('isOwner', e.record.get('user') === e.requestInfo.auth.id);
	}

	e.next();
}, 'posts');
```

- Triggered before sending records to client
- Use for response modification
- Applies to API responses, realtime events, and `apis.enrichRecord` calls

## Request Hooks

### Record CRUD Request Hooks (Have Request Context)

#### onRecordCreateRequest

```javascript
onRecordCreateRequest((e) => {
	// e.app
	// e.collection
	// e.record
	// e.httpContext (request context)
	// e.httpContext.request() - HTTP request
	// e.httpContext.queryParam(name)
	// e.httpContext.formValue(name)

	// Access request data
	const userAgent = e.httpContext.request().header.get('User-Agent');

	// Additional validation with request context
	if (e.record.get('type') === 'premium' && !e.httpContext.get('isPremiumUser')) {
		throw new Error('Premium subscription required');
	}

	e.next();
}, 'articles');
```

#### onRecordUpdateRequest

```javascript
onRecordUpdateRequest((e) => {
	// e.app
	// e.collection
	// e.record
	// e.httpContext

	// Prevent modification of certain fields via API
	const original = e.record.originalCopy();
	if (e.record.get('verified') !== original.get('verified')) {
		throw new Error('Cannot modify verified status via API');
	}

	e.next();
}, 'users');
```

#### onRecordDeleteRequest

```javascript
onRecordDeleteRequest((e) => {
	// e.app
	// e.collection
	// e.record
	// e.httpContext

	// Additional authorization check
	if (!e.httpContext.get('isAdmin') && e.record.get('protected')) {
		throw new Error('Only admins can delete protected records');
	}

	e.next();
}, 'documents');
```

#### onRecordsListRequest / onRecordViewRequest

```javascript
onRecordsListRequest((e) => {
	// e.app
	// e.collection
	// e.records
	// e.result (pagination info)
	// e.httpContext

	// Modify response (prefer onRecordEnrich instead)
	e.records.forEach((record) => {
		record.hide('internalField');
	});

	e.next();
}, 'articles');
```

**Note:** For hiding/adding fields, use `onRecordEnrich` instead as it's less error-prone

### Auth Request Hooks

#### onRecordAuthRequest

```javascript
onRecordAuthRequest((e) => {
	// e.app
	// e.record (authenticated user)
	// e.token (auth token)
	// e.meta (additional metadata)
	// e.authMethod (e.g., "password", "oauth2")
	// e.httpContext

	// Log successful login
	console.log(`User ${e.record.get('email')} authenticated via ${e.authMethod}`);

	// Update last login
	e.record.set('lastLogin', new Date());
	$app.save(e.record);

	e.next();
}, 'users');
```

- Fires on successful authentication (any method)
- After validation but before sending auth response

#### onRecordAuthWithPasswordRequest

```javascript
onRecordAuthWithPasswordRequest((e) => {
	// e.app
	// e.collection
	// e.record (can be null if no match)
	// e.identity (submitted username/email)
	// e.identityField (the field being checked)
	// e.password
	// e.httpContext

	// Custom identity lookup
	if (!e.record) {
		// Try alternate lookup
		e.record = $app.findFirstRecordByData('users', 'username', e.identity);
	}

	e.next();
}, 'users');
```

- Can manually set `e.record` for custom identity lookups

## Choosing the Right Hook

### Use Model Hooks When:

- Need logic to run regardless of how record is modified (API, console, other hooks)
- Implementing business logic that must ALWAYS happen
- Don't need request context (headers, query params, etc.)

### Use Request Hooks When:

- Need to access request context (headers, params, auth state)
- Want logic only for API calls, not internal modifications
- Need to validate or modify based on request-specific data

### Common Scenarios

**Auto-populate field on create:**

```javascript
onRecordCreate - before e.next()
```

**Send email after successful creation:**

```javascript
onRecordAfterCreateSuccess;
```

**Validate based on request headers:**

```javascript
onRecordCreateRequest - before e.next()
```

**Update related records:**

```javascript
onRecordAfterCreateSuccess or onRecordAfterUpdateSuccess
```

**Prevent field modification:**

```javascript
onRecordUpdateRequest - before e.next(), check and throw error
```

**Add computed fields to response:**

```javascript
onRecordEnrich;
```

## Common Patterns

### Prevent Infinite Recursion

```javascript
onRecordUpdate((e) => {
	e.next();

	// Update related record WITHOUT triggering its hooks
	// Utiliser une transaction pour éviter les hooks
	$app.runInTransaction((txApp) => {
		const related = txApp.findRecordById('other_collection', e.record.get('relatedId'));
		related.set('updatedCount', related.get('updatedCount') + 1);
		txApp.save(related);
	});
}, 'main_collection');
```

### Cascading Updates (With Hooks)

```javascript
onRecordUpdate((e) => {
	e.next();

	// Update related record WITH its hooks firing
	const related = $app.findRecordById('other_collection', e.record.get('relatedId'));
	related.set('status', 'updated');
	$app.save(related); // This WILL trigger other_collection's hooks
}, 'main_collection');
```

### Accessing Original vs Current Values

```javascript
onRecordUpdate((e) => {
	const original = e.record.originalCopy();
	const current = e.record;

	// Parse to JSON for easy comparison
	const originalData = JSON.parse(JSON.stringify(original));
	const currentData = JSON.parse(JSON.stringify(current));

	// Compare specific fields
	if (originalData.status !== currentData.status) {
		console.log(`Status changed from ${originalData.status} to ${currentData.status}`);
	}

	e.next();
}, 'tasks');
```

## Debugging Tips

1. **Hook not firing?**
   - Check file is `*.pb.js` format
   - Verify collection name spelling (case-sensitive!)
   - Check for syntax errors (prevents registration)
   - Confirm you're using the right hook type (Model vs Request)

2. **Infinite loops?**
   - Utilisez une transaction avec `runInTransaction()` pour modifier des records sans déclencher leurs hooks
   - Ou assurez-vous que votre condition empêche le re-déclenchement

3. **Changes not persisting?**
   - Make changes BEFORE `e.next()` for them to be included
   - Or use `*AfterSuccess` hooks and save explicitly

4. **Need request context in Model hook?**
   - You can't - Model hooks have no request context
   - Use a Request hook instead

5. **Testing hooks:**
   - Add `console.log()` statements
   - Check PocketBase console output
   - Test with API calls, not just Admin UI
