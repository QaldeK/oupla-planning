/// <reference path="../pb_data/types.d.ts" />

// Régénère src/lib/types/pocketbase-types.ts après modif de collection.
// Garde : seule l'instance de dev (data dir du dépôt) a le droit d'écrire —
// une instance jetable de test tourne depuis le même cwd et écraserait sinon
// les types avec son propre schéma (dérive silencieuse du fichier source).
const generateTypes = (e) => {
	const dataDir = String($app.dataDir() || '').replace(/\/+$/, '');
	if (dataDir !== 'pb_data' && dataDir !== './pb_data' && !dataDir.endsWith('/pocketbase/pb_data')) {
		$app.logger().warn('typegen skipped: instance not running on the repo data dir', 'dataDir', dataDir);
		e.next();
		return;
	}

	console.log('Collection changed - Running type generation...');
	const cmd = $os.cmd(
		'npx',
		'pocketbase-typegen',
		'--db',
		'pb_data/data.db',
		'--out',
		'../src/lib/types/pocketbase-types.ts'
	);
	const result = toString(cmd.output());
	console.log(result);

	e.next();
};

onCollectionAfterCreateSuccess(generateTypes);
onCollectionAfterUpdateSuccess(generateTypes);
onCollectionAfterDeleteSuccess(generateTypes);
