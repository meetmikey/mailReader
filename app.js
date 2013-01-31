var aws = require ('aws-lib')
  , sqsConnect = require('./lib/sqsConnect')
  , mailReader = require('./lib/mailReader')


sqsConnect.pollMailReaderQueue( mailReader.readMail );