var serverCommon = process.env.SERVER_COMMON;

var conf = require(serverCommon + '/conf')
  , sqsConnect = require('../serverCommon/lib/sqsConnect')
  , mailReader = require('./lib/mailReader')

console.log('mailReader app running...');

sqsConnect.pollMailReaderQueue( mailReader.readMail );