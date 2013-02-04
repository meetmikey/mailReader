var serverCommon = process.env.SERVER_COMMON;

var sqsConnect = require('../serverCommon/lib/sqsConnect')
  , mailReader = require('./lib/mailReader')


console.log('mailReader app running...');

sqsConnect.pollMailReaderQueue(
  function(messageString, callback) {
    mailReader.readMail( messageString, function(err) {
      if (err) {
        winston.handleError(err);
        callback(err);
      } else {
        callback();
      }
    })
  }
);