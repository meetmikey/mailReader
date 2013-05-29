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

appInitUtils.initApp( 'badEmail', initActions, null, function() {

  var path = './data/bad2.txt';
  
  //path = './data/googleDocLinkMail.txt';
   
  var mailParser = mailReader.getNewMailParser( mailId, userId
   , function(err){
   winston.handleError(err);
  }, function(err) {
   winston.handleError(err);
  } );


  mailParser.on ('end', function () {
    winston.doInfo('mailParser done');
  })

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
