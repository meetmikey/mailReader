var serverCommon = process.env.SERVER_COMMON;

var fs = require('fs')
  , winston = require(serverCommon + '/lib/winstonWrapper').winston
  , appInitUtils = require(serverCommon + '/lib/appInitUtils')
  , mongoose = require(serverCommon + '/lib/mongooseConnect').mongoose
  , MailParser = require('mailparser').MailParser
  , MailModel = require(serverCommon + '/schema/mail').MailModel
  , mailReader = require('../lib/mailReader')
  , async = require('async')


var COUNT = 40;

var mailId = '51476bbd64d9e02e2500001f';
var userId = '5146b7cfc8ac0fa028000005'

var initActions = [
  appInitUtils.CONNECT_MONGO
];

appInitUtils.initApp( 'bigAttachment', initActions, null, function() {

  var path = './data/mailParserBadEmail.txt';

  var dummyArray = [];
  for ( var i=0; i<COUNT; i++ ) {
    dummyArray.push('foo');
  }

  async.forEachSeries( dummyArray, function(dummy, forEachCallback) {
      
    setTimeout(forEachCallback, 3000);
    
    var mailParser = new MailParser();
    mailParser.on('end', function( parsedMail ) {
      mailReader.processMail( parsedMail, mailId, userId, function(err) {
        if ( err ) {
          winston.handleError(err);
        }
        winston.doInfo('DONE');
        mongoose.disconnect();
      });
    });

    var inp = fs.createReadStream( path );
    inp.setEncoding('utf8');
    inp.on('data', function (data) {
      //winston.doInfo('DATA');
      mailParser.write(data);
    });
    inp.on('end', function (close) {
      winston.doInfo('END DATA');
      mailParser.end();
    });
  }, function(err) {
    if ( err ) {
      winston.handleError(err);
    }
    winston.doInfo('ASYNC DONE');
  })

});