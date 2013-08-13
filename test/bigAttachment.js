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


var COUNT = 1;

var mailId = '51476bbd64d9e02e2500001f';
var userId = '5146b7cfc8ac0fa028000005';

var initActions = [
  appInitUtils.CONNECT_MONGO
];


appInitUtils.initApp( 'bigAttachment', initActions, null, function() {

  var streamAttachments = true;
  var path = './data/mailParserBadEmail.txt';
  var outputPathStream = '/home/jdurack/Desktop/streamOut.pdf';
  var outputPath = '/home/jdurack/Desktop/regularOut.pdf';
  //var path = './data/googleDocLinkMail.txt';
   
  var mailParser = new MailParser({
    streamAttachments: streamAttachments
  });


  mailParser.on('end', function( parsedMail ) {
  
    winston.doInfo('parsedMail done!');

    if ( ! streamAttachments ) {
      fs.writeFileSync( outputPath, parsedMail.attachments[0].content );
    }

    mongoose.disconnect();
  });

  mailParser.on("attachment", function(attachment){

    utils.streamToBuffer( attachment.stream, false, function(err, attachmentBuffer ) {
      fs.writeFileSync( outputPathStream, attachmentBuffer );
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

});