var serverCommon = process.env.SERVER_COMMON;

var winston = require (serverCommon + '/lib/winstonWrapper').winston
  , LinkModel = require(serverCommon + '/schema/link').LinkModel
  , linkHandler = require('../lib/linkHandler')

LinkModel.find({}, function(err, foundLinks) {
  if ( err ) {
    winston.doMongoError(err);
  } else {
    /*
    //TODO: write this...
    */
  }
});