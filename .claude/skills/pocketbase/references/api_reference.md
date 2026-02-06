# PocketBase API Reference (v0.36+)

Quick reference for common PocketBase operations in hooks.

**⚠️ Important changement depuis v0.36** : Les méthodes `.dao()` ont été supprimées. Utilisez directement `$app.method()` au lieu de `$app.dao().method()`.

## Database Access

### Raw Database Access with `$app.db()`

Pour les requêtes SQL brutes et les opérations de base de données sans passer par la couche de collection.

```javascript
// Get raw database connection
const db = $app.db();

// Select with raw SQL (retourne tableau d'objets)
const records = db.newQuery("SELECT * FROM posts WHERE status = 'published'").all();

// Select avec DynamicModel typé
const result = arrayOf(
	new DynamicModel({
		id: '',
		title: '',
		content: '',
		views: 0
	})
);
db.newQuery("SELECT id, title, content, views FROM posts WHERE status = 'published'").all(result);

// Select with parameters
db.newQuery('SELECT * FROM posts WHERE status = {:status} AND author_id = {:authorId}')
	.bind({ status: 'published', authorId: 'xyz123' })
	.all(result);

// Execute arbitrary SQL (ne retourne pas de données)
db.newQuery('UPDATE posts SET views = views + 1 WHERE id = {:id}', { id: 'recordId' }).execute();
db.newQuery("DELETE FROM posts WHERE status = 'archived'").execute();
```

### Query Builder

```javascript
// Construire des requêtes SQL programmatiquement
const result = arrayOf(
	new DynamicModel({
		id: '',
		email: ''
	})
);

$app
	.db()
	.select('id', 'email')
	.from('users')
	.andWhere($dbx.like('email', 'example.com'))
	.limit(100)
	.orderBy('created ASC')
	.all(result);
```

### DynamicModel pour les modèles dynamiques typés

```javascript
// Créer un modèle dynamique
const PostModel = new DynamicModel({
	id: '',
	title: '',
	content: '',
	views: 0,
	tags: [],
	created: '',
	updated: ''
});

// Utiliser avec $app.db()
const posts = $app.db().newQuery('SELECT * FROM posts').all(arrayOf(new PostModel()));

// Accès typé
posts.forEach((post) => {
	console.log(post.title); // TypeScript sait que c'est un string
	console.log(post.views); // TypeScript sait que c'est un number
});
```

### Expressions de requête avancées ($dbx)

```javascript
// Expression simple
const exp = $dbx.exp('age >= 18');

// Expression avec hash pour les conditions complexes
const exp = $dbx.hashExp({
	status: 'published',
	created: $dbx.exp('>= {:date}', { date: '2024-01-01' })
});

// Opérateurs LIKE
const likeExp = $dbx.like('name', 'john'); // name LIKE '%john%'
const orLikeExp = $dbx.orLike('name', 'test1', 'test2'); // name LIKE '%test1%' OR name LIKE '%test2%'

// Expressions IN / NOT IN
const inExp = $dbx.in('status', 'draft', 'published', 'archived');
const notInExp = $dbx.notIn('status', 'deleted', 'archived');

// Expressions BETWEEN
const between = $dbx.between('created', '2024-01-01', '2024-12-31');

// Expressions AND / OR / NOT
const andExp = $dbx.and($dbx.exp('age >= 18'), $dbx.exp('verified = true'));
const orExp = $dbx.or($dbx.exp("status = 'active'"), $dbx.exp("status = 'pending'"));
const notExp = $dbx.not($dbx.exp("status = 'deleted'"));
```

### Transactions

```javascript
// Exécuter des opérations dans une transaction
$app.runInTransaction((txApp) => {
	// Toutes les opérations dans ce callback sont transactionnelles

	// Trouver et mettre à jour un record
	const record = txApp.findRecordById('articles', 'RECORD_ID');
	record.set('status', 'active');
	txApp.save(record);

	// Exécuter une requête SQL brute (ne déclenche pas les hooks)
	txApp.db().newQuery("DELETE FROM articles WHERE status = 'pending'").execute();

	// Si une exception est lancée, la transaction est annulée (rollback)
	// Sinon, elle est validée (commit) automatiquement
});

// ⚠️ IMPORTANT: Dans une transaction, utilisez TOUJOURS txApp (le paramètre du callback)
// et non $app pour éviter les deadlocks (un seul writer/transaction à la fois).
```

## Finding Records

```javascript
// Find by ID
const record = $app.findRecordById('collectionName', 'recordId');

// Find first matching record by data
const record = $app.findFirstRecordByData('users', 'email', 'user@example.com');

// Find with filter
const record = $app.findFirstRecordByFilter('users', 'email = {:email} && active = true', {
	email: 'user@example.com'
});

// Find multiple records
const records = $app.findRecordsByFilter(
	'posts',
	"status = 'published' && author = {:authorId}",
	'-created', // sort order (- for DESC, + for ASC)
	50, // limit
	{ authorId: 'xyz123' }
);

// Find all records (no filter)
const records = $app.findRecordsByFilter('posts', '1=1', '-created', 100);
```

## Saving Records

```javascript
// Save with hooks (déclenche onRecordValidate, onRecordCreate, etc.)
$app.save(record);

// Save without validation
$app.saveNoValidate(record);

// Dans les hooks, utiliser e.app pour éviter les boucles infinies
onRecordAfterCreateSuccess((e) => {
	const related = e.app.findRecordById('other', e.record.get('otherId'));
	related.set('count', related.get('count') + 1);
	e.app.save(related);
	e.next();
}, 'main');
```

## Deleting Records

```javascript
// Delete with hooks (déclenche onRecordDelete, etc.)
$app.delete(record);

// Delete file from record
$app.deleteFileById(record, 'filename.jpg');
```

## Collections

```javascript
// Get collection
const collection = $app.findCollectionByNameOrId('posts');

// Create new record instance
const record = new Record(collection);
```

## Record Operations

### Getting/Setting Values

```javascript
// Get value
const value = record.get('fieldName');

// Set value
record.set('fieldName', value);

// Get original (before changes)
const original = record.originalCopy();

// Get clean copy
const clean = record.cleanCopy();

// Get ID
const id = record.id;

// Get collection name
const collectionName = record.collection().name;
```

### Working with Auth Records

```javascript
// Get email
const email = record.email();

// Check if email is verified
const isVerified = record.verified();

// Get username (if collection has username field)
const username = record.username();
```

### Hiding/Showing Fields

```javascript
// Hide field from response
record.hide('secretField');

// Hide multiple fields
record.hide('field1', 'field2', 'field3');

// Enable custom data (required for computed fields)
record.withCustomData(true);
```

### File Operations

```javascript
// Get file URL
const fileUrl = record.fileUrl('avatar', 'thumbnail');

// Get all file URLs for multi-file field
const fileUrls = record.fileUrls('attachments');
```

## HTTP Operations

### Making HTTP Requests

```javascript
// GET request
const response = $http.send({
	url: 'https://api.example.com/data',
	method: 'GET',
	headers: {
		Authorization: 'Bearer token123'
	}
});

// POST request
const response = $http.send({
	url: 'https://api.example.com/data',
	method: 'POST',
	body: JSON.stringify({ key: 'value' }),
	headers: {
		'Content-Type': 'application/json'
	}
});

// Access response
console.log(response.statusCode);
console.log(response.headers);
const data = response.json; // Parsed JSON
const text = response.raw; // Raw response
```

## Email Operations

### Sending Email

```javascript
const message = new MailerMessage({
	from: {
		address: $app.settings().meta.senderAddress,
		name: $app.settings().meta.senderName
	},
	to: [{ address: 'user@example.com', name: 'User Name' }],
	cc: [{ address: 'cc@example.com' }],
	bcc: [{ address: 'bcc@example.com' }],
	subject: 'Email Subject',
	html: '<h1>HTML Content</h1>',
	text: 'Plain text content',
	headers: {
		'X-Custom-Header': 'value'
	}
});

$app.newMailClient().send(message);
```

## Settings

### Accessing Settings

```javascript
// Get all settings
const settings = $app.settings();

// Get meta settings
const meta = $app.settings().meta;

// Sender email
const senderEmail = $app.settings().meta.senderAddress;
const senderName = $app.settings().meta.senderName;

// App name and URL
const appName = $app.settings().meta.appName;
const appUrl = $app.settings().meta.appUrl;

// Logs settings
const maxDays = $app.settings().logs.maxDays;
```

## Validation

### Validating Records

```javascript
// Validate record
$app.validate(record);

// Validate without throwing (returns validation errors)
try {
	$app.validate(record);
} catch (err) {
	console.log('Validation errors:', err.data);
}
```

## Realtime (v0.36+)

### Sending Realtime Messages

```javascript
// Utiliser le subscriptions broker (méthode recommandée)
$app.subscriptionsBroker().broadcast({
	topic: 'collectionName',
	data: {
		action: 'create',
		record: record
	}
});

// Envoyer à des utilisateurs spécifiques
$app.subscriptionsBroker().broadcastByUsers({
	users: ['userId1', 'userId2'],
	data: {
		action: 'update',
		record: record
	}
});

// Envoyer par emails
$app.subscriptionsBroker().broadcastByEmails({
	emails: ['user@example.com'],
	data: {
		action: 'delete',
		record: recordId
	}
});
```

## Utilities

### Token Generation

```javascript
// Generate record token
const token = $tokens.recordAuthToken($app, record);

// Generate admin token
const token = $tokens.adminAuthToken($app, admin);
```

### Security

```javascript
// Hash password
const hash = $security.hashPassword('password123');

// Compare password with hash
const matches = $security.compareHashAndPassword(hash, 'password123');

// Generate random string
const randomStr = $security.randomString(32);

// Generate random string with alphabet
const randomStr = $security.randomStringWithAlphabet(32, '0123456789abcdef');
```

### Date/Time

```javascript
// Current date/time in ISO format
const now = new Date().toISOString();

// Parse date string
const date = new Date('2024-01-15T10:30:00Z');

// Format for PocketBase filters (RFC3339)
const formatted = date.toISOString(); // "2024-01-15T10:30:00.000Z"
```

## Request Context (in Request hooks)

### Accessing Request Data

```javascript
// Get HTTP request
const req = e.httpContext.request();

// Get auth record
const authRecord = e.httpContext.get('authRecord');

// Get query parameter
const page = e.httpContext.queryParam('page');

// Get form value
const title = e.httpContext.formValue('title');

// Get header
const userAgent = req.header.get('User-Agent');

// Get client IP
const ip = e.httpContext.realIP();
```

## Filter Syntax

### Query Parameters

```javascript
// Basic equality
"name = 'John'";

// Comparison
'age >= 18';
"created > '2024-01-01 00:00:00.000Z'";

// Multiple conditions
"status = 'active' && age >= 18";
"role = 'admin' || role = 'moderator'";

// LIKE/Contains
'name ~ \'john\''; // Case-insensitive contains
'email !~ \'@test\''; // Does not contain

// Array fields
'tags ?= \'javascript\''; // Array contains value
'roles ?!= \'admin\''; // Array doesn't contain value

// Relation fields
'author.name = \'John\'';
'team.status = \'active\'';

// Check for empty/null
'description = \'\'';
'optionalField = null';

// Parameterized (recommended)
'email = {:email} && status = {:status}';
```

### Sort Order

```javascript
'-created'; // Descending by created
'+name'; // Ascending by name
'-created,+name'; // Multiple fields
```

## Common Patterns

### Checking if Record Exists

```javascript
try {
	const record = $app.findRecordById('users', userId);
	// Record exists
} catch (err) {
	// Record doesn't exist
}
```

### Safe Record Access

```javascript
try {
	const author = $app.findRecordById('users', record.get('author'));
	// Use author
} catch (err) {
	console.error('Author not found:', err);
	// Handle missing author
}
```

### Updating Multiple Records

```javascript
const records = $app.findRecordsByFilter('tasks', 'project = {:projectId}', '', 0, {
	projectId: projectId
});

records.forEach((record) => {
	record.set('status', 'completed');
	$app.save(record);
});
```

### Transaction-like Operations

```javascript
// NOUVEAU: Transaction explicite (v0.36+)
onRecordCreate((e) => {
	$app.runInTransaction((txApp) => {
		// Créer l'enregistrement principal
		e.record.set('status', 'pending');

		// Créer un enregistrement lié
		const relatedRecord = new Record(e.app.findCollectionByNameOrId('related'));
		relatedRecord.set('parentId', e.record.id);
		txApp.save(relatedRecord);

		// Toutes les opérations sont transactionnelles
		// Si une erreur survient, tout est annulé (rollback)
	});
}, 'main_collection');

// ANCIENNE MÉTHODE: Implicite par défaut (toujours supportée)
onRecordCreate((e) => {
	// Ces opérations sont dans la même transaction implicite
	e.record.set('status', 'pending');

	// Créer un enregistrement lié
	const relatedRecord = new Record(e.app.findCollectionByNameOrId('related'));
	relatedRecord.set('parentId', e.record.id);
	e.app.save(relatedRecord);

	e.next(); // La transaction est validée après e.next()
}, 'main_collection');
```

## Backup & Recovery

### Manual Backup

The entire PocketBase application state is contained in the `pb_data` directory.

```bash
# Stop PocketBase for transactional safety (optional but recommended)
systemctl stop pocketbase  # or kill the process

# Backup the entire pb_data directory
cp -r pb_data pb_data_backup_$(date +%Y%m%d_%H%M%S)

# Or create compressed backup
tar -czf pb_data_backup_$(date +%Y%m%d_%H%M%S).tar.gz pb_data

# Restart PocketBase
systemctl start pocketbase
```

### Automated Backups via Hooks

```javascript
/// <reference path="../pb_data/types.d.ts" />

// Customize what gets backed up
onBackupCreate((e) => {
	// Exclude unwanted directories (added in v0.30+)
	e.exclude.push('lost+found');
	e.exclude.push('temp');

	console.log('Creating backup:', e.name);

	e.next();
});

// Post-backup actions
onBackupRestore((e) => {
	console.log('Restoring from backup:', e.name);

	e.next();
});
```

### Restore from Backup

```bash
# Stop PocketBase
systemctl stop pocketbase

# Backup current state (safety)
mv pb_data pb_data_old

# Restore from backup
tar -xzf pb_data_backup_YYYYMMDD_HHMMSS.tar.gz
# or: cp -r pb_data_backup_YYYYMMDD_HHMMSS pb_data

# Start PocketBase
systemctl start pocketbase

# Verify restoration
curl http://localhost:8090/api/health
```

### What Gets Backed Up

The `pb_data` directory contains:

- `data.db` - Main SQLite database (all records, collections, settings)
- `logs.db` - Request logs (if enabled)
- `storage/` - Uploaded files
- `backups/` - Automatic backups (if configured)

### Production Best Practices

1. **Backup Schedule**: Daily backups minimum for production
2. **Transactional Safety**: Stop PocketBase or use backup hooks
3. **Offsite Storage**: Copy backups to separate server/cloud storage
4. **Test Restores**: Regularly verify backup restoration works
5. **Retention Policy**: Keep multiple backup generations (e.g., 30 days)
6. **Monitor Backups**: Alert on backup failures

### Backup Script Example

```bash
#!/bin/bash
# save as: /usr/local/bin/backup-pocketbase.sh

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups/pocketbase"
PB_DATA="/opt/pocketbase/pb_data"
RETENTION_DAYS=30

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Create backup (PocketBase keeps running)
tar -czf "$BACKUP_DIR/pb_data_$DATE.tar.gz" -C "$(dirname "$PB_DATA")" "$(basename "$PB_DATA")"

# Verify backup was created
if [ -f "$BACKUP_DIR/pb_data_$DATE.tar.gz" ]; then
	echo "Backup created: pb_data_$DATE.tar.gz"

	# Copy to remote server (optional)
	# rsync -az "$BACKUP_DIR/pb_data_$DATE.tar.gz" user@backup-server:/backups/

	# Remove old backups
	find "$BACKUP_DIR" -name "pb_data_*.tar.gz" -mtime +$RETENTION_DAYS -delete
else
	echo "ERROR: Backup failed!"
	exit 1
fi
```

Add to crontab for daily backups:

```bash
# Run daily at 2 AM
0 2 * * * /usr/local/bin/backup-pocketbase.sh >> /var/log/pocketbase-backup.log 2>&1
```

### Important Notes

- PocketBase can run during backups, but stopping ensures consistency
- Settings encryption cannot be disabled once enabled
- Backups include all collections, settings, files, and logs
- Database size grows over time - monitor disk space
- Backup before major updates or migrations
