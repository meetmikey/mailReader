var serverCommon = process.env.SERVER_COMMON;

var appInitUtils = require(serverCommon + '/lib/appInitUtils')
  , winston = require(serverCommon + '/lib/winstonWrapper').winston
  , sqsConnect = require(serverCommon + '/lib/sqsConnect')
  , mailReader = require('./lib/mailReader')
  , serverCommonConf = require (serverCommon + '/conf')
  , mailReaderConstants = require('./constants')

var initActions = [
    appInitUtils.CONNECT_ELASTIC_SEARCH
  , appInitUtils.CONNECT_MONGO
  , appInitUtils.RESTART_EMAIL
  //, appInitUtils.MEMWATCH_MONITOR
];

//serverCommonConf.turnDebugModeOn()

//initApp() will not callback an error.
//If something fails, it will just exit the process.
appInitUtils.initApp( 'mailReader', initActions, serverCommonConf, function() {
  
  var maxWorkers = mailReaderConstants.MAX_WORKERS;
  if ( process && process.argv && ( process.argv.length > 2 ) ) {
    maxWorkers = process.argv[2];
  }

  winston.doInfo('maxWorkers: ' + maxWorkers);

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
    }, maxWorkers, mailReaderConstants.WORKER_TIMEOUT
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
    }, maxWorkers, mailReaderConstants.WORKER_TIMEOUT
  );
});
