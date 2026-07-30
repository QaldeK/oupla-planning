/// <reference path="../pb_data/types.d.ts" />

const generateTypes = (e) => {
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
