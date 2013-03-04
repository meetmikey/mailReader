var serverCommon = process.env.SERVER_COMMON;

var mongoose = require(serverCommon + '/lib/mongooseConnect')
  , linkHandler = require('../lib/linkHandler')
  , mailReader = require('../lib/mailReader')
  , MailParser = require('mailparser').MailParser
  , fs = require('fs')
  , winston = require(serverCommon + '/lib/winstonWrapper').winston
  , MailModel = require(serverCommon + '/schema/mail').MailModel
  , AttachmentModel = require(serverCommon + '/schema/attachment').AttachmentModel
  , async = require('async')
  , mailUtils = require(serverCommon + '/lib/mailUtils')
  , crypto = require('crypto')

var emailFiles = [
   './test/data/googleDocLinkMail.txt'
];

var mailIds = [];
var userId = '51270bf03139c5483f000004';
var gmThreadId = '1425175090881070972';
var uid = 1;
var mailParserDoneCallback;

var threadAttachment = this;


exports.handleParsedMail = function( parsedMail, callback ) {

  threadAttachment.createMail( parsedMail, function(err, mail) {
    if ( err ) {
      callback(err);

    } else if ( ! mail ) {
      callback( winston.makeError('no mail') );

    } else {
      mailIds.push(mail._id);
      linkHandler.extractLinks( parsedMail, mail, callback );
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

  winston.info('running...');

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
    //threadAttachment.cleanup();
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
      winston.info('cleanup done!');
    }
  });
}

threadAttachment.run();