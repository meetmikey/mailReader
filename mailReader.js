var serverCommon = process.env.SERVER_COMMON;

var winston = require (serverCommon + '/lib/winstonWrapper').winston;
winston.logBreak();

var mongoose = require(serverCommon + '/lib/mongooseConnect')
  , sqsConnect = require(serverCommon + '/lib/sqsConnect')
  , mailReader = require('./lib/mailReader')
  , mailReaderConstants = require('./constants')


process.on('uncaughtException', function (err) {
  winston.doError('uncaughtException:', {stack : err.stack, message : err.message});
  process.exit(1);
});

var maxHandlers = mailReaderConstants.MAX_HANDLERS;
if ( process && process.argv && ( process.argv.length > 2 ) ) {
  maxHandlers = process.argv[2];
}

winston.doInfo('mailReader app running...');
winston.doInfo('maxHandlers: ' + maxHandlers);

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
  }, maxHandlers
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
  }, maxHandlers
);