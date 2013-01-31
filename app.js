var sqsConnect = require('../serverCommon/lib/sqsConnect')
  , mailReader = require('./lib/mailReader')


console.log('mailReader app running...');

sqsConnect.pollMailReaderQueue( mailReader.readMail );