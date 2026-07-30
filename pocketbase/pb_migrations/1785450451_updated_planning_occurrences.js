/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("r3063827249c74")

  // update collection data
  unmarshal({
    "createRule": "@request.query._token != \"\" && master.adminToken = @request.query._token"
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("r3063827249c74")

  // update collection data
  unmarshal({
    "createRule": ""
  }, collection)

  return app.save(collection)
})
