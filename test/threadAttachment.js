var serverCommon = process.env.SERVER_COMMON;

var mongoose = require(serverCommon + '/lib/mongooseConnect')
  , attachmentHandler = require('../lib/attachmentHandler')
  , mailReader = require('../lib/mailReader')
  , MailParser = require('mailparser').MailParser
  , fs = require('fs')
  , winston = require(serverCommon + '/lib/winstonWrapper').winston
  , MailModel = require(serverCommon + '/schema/mail').MailModel
  , AttachmentModel = require(serverCommon + '/schema/attachment').AttachmentModel
  , async = require('async')
  , appInitUtils = require (serverCommon + '/lib/appInitUtils')
  , mailUtils = require(serverCommon + '/lib/mailUtils')
  , crypto = require('crypto')

var emailFiles = [
   './test/data/thread/2744-body.txt'
  , './test/data/thread/2736-body.txt'
  , './test/data/thread/2739-body.txt'
];

var mailIds = [];
var userId = '51105236d50c88ebe8ef30cc';
var gmThreadId = '1425175090881070972';
var uid = 1;
var mailParserDoneCallback;

var threadAttachment = this;



var initActions = [
  appInitUtils.CONNECT_MONGO
];

appInitUtils.initApp( 'threadAttachment', initActions, null, function() {
  threadAttachment.run();  
});


exports.handleParsedMail = function( parsedMail, callback ) {

  threadAttachment.createMail( parsedMail, function(err, mail) {
    if ( err ) {
      callback(err);

    } else if ( ! mail ) {
      callback( winston.makeError('no mail') );

    } else {
      mailIds.push(mail._id);
      attachmentHandler.handleAttachments( parsedMail, mail, callback );
    }
  });
}

exports.createMail = function( parsedMail, callback ) {

  var numAttachments = mailUtils.getNumAttachments( parsedMail );
  var hasAttachment = false;
  if ( numAttachments > 0 ) {
    hasAttachment = true;
  }

  var mail = new MailModel({
      userId: userId
    , messageId: mailUtils.getMessageId( parsedMail )
    , sender: mailUtils.getSender( parsedMail )
    , recipients: mailUtils.getAllRecipients( parsedMail )
    , subject: mailUtils.getDirtySubject( parsedMail.subject )
    , cleanSubject: mailUtils.getCleanSubject( parsedMail.subject )
    , bodyText: mailUtils.getBodyText( parsedMail )
    , bodyHTML: mailUtils.getBodyHTML( parsedMail )
    , numAttachments: numAttachments
    , sentDate: mailUtils.getSentDate( parsedMail )
    , mailReaderState: 'started'
    , gmThreadId: gmThreadId
    , gmMsgId : '123456'
    , hasAttachment: hasAttachment
    , hasMarketingFrom: false
    , hasMarketingText: false
    , uid: uid
  });
  uid++;

  mail.save( function(err) {
    if ( err ) {
      callback( winston.makeMongoError( err ) );
    } else {
      callback(null, mail);
    }
  });
}

exports.run = function() {

  winston.doInfo('running...');

  async.forEachSeries( emailFiles, function(emailFile, forEachSeriesCallback) {
    fs.readFile( emailFile, function(err, res) {
      if ( err ) {
        forEachSeriesCallback( winston.makeError('error reading file') );
        
      } else if ( ! res ) {
        forEachSeriesCallback( winston.makeMissingParamError('res') );

      } else {

        var mailParser = new MailParser();

        mailParser.on('end', function( parsedMail ) {
          threadAttachment.handleParsedMail( parsedMail, function(err) {
            if ( err ) {
              winston.handleError(err);
            }
            mailParserDoneCallback();
          });
        });

        mailParser.write(res);
        mailParser.end();
        mailParserDoneCallback = forEachSeriesCallback;
      }
    });
  }, function(err) {
    if ( err ) {
      winston.handleError(err);
    }
    threadAttachment.cleanup();
  });
}

exports.cleanup = function() {
  async.forEach( mailIds, function(mailId, forEachCallback) {
    AttachmentModel.find({mailId:mailId}).remove();
    MailModel.find({_id:mailId}).remove();
    forEachCallback();
  }, function(err) {
    if ( err ) {
      winston.handleError(err);
    } else {
      mongoose.disconnect();
      winston.doInfo('cleanup done!');
    }
  });
}

