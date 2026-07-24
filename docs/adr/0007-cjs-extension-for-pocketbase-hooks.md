# Extension `.cjs` pour les hooks partagés PocketBase

Les modules hooks partagés entre fichiers JSVM (`pb-helpers.js`) utilisent l'extension `.cjs` plutôt que `.js`.

## Contexte

Le projet frontend est ESM (`"type": "module"` dans `package.json`). Les hooks PocketBase sont CommonJS (`require()` / `module.exports`) car le runtime goja ne supporte pas les ES modules. Lorsque des hooks CJS s'`require()`-ent mutuellement (ex : `notification-jx-detector.js` → `pb-helpers.js`), vitest/Vite ne peut pas intercepter les appels `require()` dynamiques (`${__hooks}/...`). Le require natif de Node voit l'extension `.js` + `"type": "module"` → traite le fichier comme ESM → `module` n'existe pas → `ReferenceError`.

## Décision

Renommer les modules hooks mutualisés avec l'extension `.cjs`. Cette extension indique explicitement à Node/Bun de traiter le fichier comme CommonJS, quelle que soit la valeur de `"type": "module"` dans `package.json`. C'est la convention standard Node.js pour le CJS dans un projet ESM.

## Vérification PocketBase JSVM

Le `require()` de goja_nodejs (`getCompiledSource` dans `module.go`) wrappe tout fichier non-`.json` dans une fonction CJS : `(function(exports,require,module,__filename,__dirname){...})`. L'extension du fichier est sans importance — seuls `.json` ont un traitement spécial. Le renommage est donc transparent pour PocketBase.

## Conséquences

- Les require() dans les hooks référencent `${__hooks}/<module>.cjs` au lieu de `.js`.
- Les modules `.pb.js` (hooks d'entrée) ne changent pas — ils sont chargés par le pattern `HooksFilesPattern` de PocketBase et ne sont pas `require()`-és entre eux.
- Les tests unitaires importent les hooks via `await import()` + interop CJS de vitest, ce qui fonctionne nativement avec `.cjs`.
