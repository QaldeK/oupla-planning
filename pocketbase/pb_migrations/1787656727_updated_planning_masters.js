/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("rcf2c91ab2d814")

  // add field
  collection.fields.addAt(21, new Field({
    "help": "",
    "hidden": false,
    "id": "date3946532404",
    "max": "",
    "min": "",
    "name": "deletedAt",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "date"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("rcf2c91ab2d814")

  // remove field
  collection.fields.removeById("date3946532404")

  return app.save(collection)
})
