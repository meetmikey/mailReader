var sqsConnect = require('./lib/sqsConnect')
  , mailReader = require('./lib/mailReader')


console.log('mailReader app running...');

sqsConnect.pollMailReaderQueue( mailReader.readMail );