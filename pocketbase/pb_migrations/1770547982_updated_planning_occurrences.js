/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("r3063827249c74")

  // add field
  collection.fields.addAt(14, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text3821698244",
    "max": 0,
    "min": 0,
    "name": "adminToken",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": true,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(15, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text392686618",
    "max": 0,
    "min": 0,
    "name": "participantToken",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": true,
    "system": false,
    "type": "text"
  }))

  // update field
  collection.fields.addAt(0, new Field({
    "autogeneratePattern": "[a-z0-9]{15}",
    "hidden": false,
    "id": "165c68a756",
    "max": 15,
    "min": 15,
    "name": "id",
    "pattern": "^[a-z0-9]+$",
    "presentable": false,
    "primaryKey": true,
    "required": true,
    "system": true,
    "type": "text"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("r3063827249c74")

  // remove field
  collection.fields.removeById("text3821698244")

  // remove field
  collection.fields.removeById("text392686618")

  // update field
  collection.fields.addAt(0, new Field({
    "autogeneratePattern": "[a-z0-9]{15}",
    "hidden": false,
    "id": "165c68a756",
    "max": 15,
    "min": 15,
    "name": "id",
    "pattern": "^[a-z0-9]+$",
    "presentable": false,
    "primaryKey": true,
    "required": true,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
})
