var conf = require('./conf')
  , sqsConnect = require('../serverCommon/lib/sqsConnect')
  , mailReader = require('./lib/mailReader')
  , mongoose = require('mongoose')

console.log('mailReader app running...');

var mongoPath = 'mongodb://' + conf.mongo.local.host + '/' + conf.mongo.local.db;
mongoose.connect(mongoPath, function (err) {
  if (err) throw err;
})

sqsConnect.pollMailReaderQueue( mailReader.readMail );