var serverCommon = process.env.SERVER_COMMON;

var winston = require (serverCommon + '/lib/winstonWrapper').winston
  , LinkModel = require(serverCommon + '/schema/link').LinkModel
  , linkHandler = require('../lib/linkHandler')

LinkModel.find({}, function(err, foundLinks) {
  if ( err ) {
    winston.doMongoError(err);
  } else {
    linkHandler.checkAndPromoteLinks(foundLinks, null, true,
      function(err) {
        if ( err ) {
          winston.handleError( err );
        } else {
          winston.info('done!');
        }
      }
    )
  }
});