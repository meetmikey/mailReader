var serverCommon = process.env.SERVER_COMMON;

var fs = require('fs')
  , winston = require(serverCommon + '/lib/winstonWrapper').winston
  , appInitUtils = require(serverCommon + '/lib/appInitUtils')
  , mailUtils = require(serverCommon + '/lib/mailUtils')
  , utils = require(serverCommon + '/lib/utils')
  , mongoose = require(serverCommon + '/lib/mongooseConnect').mongoose
  , MailParser = require('mailparser').MailParser
  , MailModel = require(serverCommon + '/schema/mail').MailModel
  , mailReader = require('../lib/mailReader')
  , async = require('async')


var mailId = '51476bbd64d9e02e2500001f';
var userId = '5146b7cfc8ac0fa028000005';

var initActions = [
  appInitUtils.CONNECT_MONGO
];

appInitUtils.initApp( 'bigAttachment', initActions, null, function() {

  var path = './data/mailParserBadEmail.txt';
  var outputPathStream = '/home/jdurack/Desktop/streamOut.pdf';
  var outputPath = '/home/jdurack/Desktop/regularOut.pdf';
  var message = {
    userId = 'someId',
    rawMailCloudPath = 'somePath',
    mailId = 'someMailId',
    inAzure : true,
    isQuick : true
  }
  //path = './data/googleDocLinkMail.txt';
   
  var mailParser = mailReader.getNewMailParser( message, mailId, userId
   , function(err){
   winston.handleError(err);
  }, function(err) {
   winston.handleError(err);
  } );

  fs.readFile( path, function(err, data) {
   if ( err ) {
      winston.doError('fs err', {err: err});

   } else{
      mailParser.write(data);
      mailParser.end();
   }
  });

   mongoose.disconnect();

});