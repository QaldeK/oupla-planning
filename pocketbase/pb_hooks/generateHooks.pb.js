/// <reference path="../pb_data/types.d.ts" />

// Régénère src/lib/types/pocketbase-types.ts après modif de collection.
//
// Trois gardes, cumulatives :
//  - opt-in explicite `PB_TYPEGEN=1` : seule la commande `bun run dev:pb` le
//    pose. Une instance jetable de test, un conteneur de prod ou un serveur
//    lancé à la main ne réécrivent jamais le fichier committé ;
//  - data dir du dépôt : une instance qui pointe ailleurs est ignorée ;
//  - collections `tmp_*` : les tests d'intégration créent/suppriment des
//    collections jetables sur l'instance de dev — sans ce filtre, chaque run
//    réécrirait les types avec un schéma de test.
const generateTypes = (e) => {
	const dataDir = String($app.dataDir() || '')
		.replace(/\\/g, '/')
		.replace(/\/+$/, '');
	const collectionName = e.collection ? String(e.collection.name || '') : '';
	const optedIn = $os.getenv('PB_TYPEGEN') === '1';
	const isRepoDev =
		dataDir === 'pb_data' || dataDir === './pb_data' || dataDir.endsWith('/pocketbase/pb_data');

	if (!optedIn || !isRepoDev || collectionName.startsWith('tmp_')) {
		$app
			.logger()
			.warn(
				'typegen skipped',
				'dataDir',
				dataDir,
				'collection',
				collectionName,
				'optedIn',
				optedIn
			);
		e.next();
		return;
	}

	console.log('Collection changed - Running type generation...');
	// `dev:pb` fait `cd pocketbase` avant de lancer le serveur : les chemins
	// relatifs ci-dessous sont donc ceux du data dir du dépôt.
	const dbPath = dataDir.endsWith('/pocketbase/pb_data') ? `${dataDir}/data.db` : 'pb_data/data.db';
	const cmd = $os.cmd(
		'npx',
		'pocketbase-typegen',
		'--db',
		dbPath,
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
