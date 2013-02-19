var serverCommon = process.env.SERVER_COMMON;

var mongoose = require(serverCommon + '/lib/mongooseConnect')
  , sqsConnect = require('../serverCommon/lib/sqsConnect')
  , mailReader = require('./lib/mailReader')
  , winston = require (serverCommon + '/lib/winstonWrapper').winston

console.log('mailReader app running...');

winston.logToFiles('mailReader');

var MAX_HANDLERS = 1;
if ( process && process.argv && ( process.argv.length > 2 ) ) {
  MAX_HANDLERS = process.argv[2];
}

sqsConnect.pollMailReaderQueue(
  function(messageString, callback) {
    mailReader.handleMailMessage( messageString, function(err) {
      if (err) {
        winston.handleError(err);
        callback(err);
      } else {
        callback();
      }
    })
  }, MAX_HANDLERS
);