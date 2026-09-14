module.exports = app => {
  const webhook = require("../controllers/webhook.controller.js");
  const express = require("express");
  var router = express.Router();

  
  router.post("/", express.raw({ type: 'application/json' }), webhook.stripeWebhook);

  app.use('/api/webhook', router);
};