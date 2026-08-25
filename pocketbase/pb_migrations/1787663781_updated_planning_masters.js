/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("rcf2c91ab2d814")

  // update collection data
  unmarshal({
    "deleteRule": null
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("rcf2c91ab2d814")

  // update collection data
  unmarshal({
    "deleteRule": "@request.query._token != \"\" && adminToken = @request.query._token"
  }, collection)

  return app.save(collection)
})
