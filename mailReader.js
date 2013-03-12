var serverCommon = process.env.SERVER_COMMON;

var mongoose = require(serverCommon + '/lib/mongooseConnect')
  , sqsConnect = require(serverCommon + '/lib/sqsConnect')
  , mailReader = require('./lib/mailReader')
  , winston = require (serverCommon + '/lib/winstonWrapper').winston

winston.doInfo('mailReader app running...');

// clear visual indication in logs of restart
console.log ('\n\n\n\n\n\n\n\n\n\n\n\n\n');
console.error ('\n\n\n\n\n\n\n\n\n\n\n\n\n');

process.on('uncaughtException', function (err) {
  winston.doError('uncaughtException:', {stack : err.stack, message : err.message});
  process.exit(1);
});

var MAX_HANDLERS = 20;
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


sqsConnect.pollMailReaderQuickQueue(
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