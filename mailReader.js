var serverCommon = process.env.SERVER_COMMON;

var appInitUtils = require(serverCommon + '/lib/appInitUtils')
  , winston = require(serverCommon + '/lib/winstonWrapper').wrapper
  , sqsConnect = require(serverCommon + '/lib/sqsConnect')
  , mailReader = require('./lib/mailReader')
  , mailReaderConstants = require('./constants')

var initActions = [
    appInitUtils.CONNECT_ELASTIC_SEARCH
  , appInitUtils.CONNECT_MONGO
];

//initApp() will not callback an error.
//If something fails, it will just exit the process.
appInitUtils.initApp( 'mailReader', initActions, function() {
  var maxHandlers = mailReaderConstants.MAX_HANDLERS;
  if ( process && process.argv && ( process.argv.length > 2 ) ) {
    maxHandlers = process.argv[2];
  }

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
});