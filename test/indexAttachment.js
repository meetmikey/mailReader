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
  , mailUtils = require(serverCommon + '/lib/mailUtils')
  , crypto = require('crypto')
  , assert = require ('assert')

var emailFiles = [
   './test/data/thread/2744-body.txt'
  , './test/data/thread/2736-body.txt'
  , './test/data/thread/2739-body.txt'
];

var mailIds = [];
var userId = '51105236d50c88ebe8ef30cc';
var gmThreadId = '1425175090881070972';
var gmMsgId = '12345'
var uid = 1;
var mailParserDoneCallback;

var indexAttachment = this;


exports.handleParsedMail = function( parsedMail, callback ) {

  indexAttachment.createMail( parsedMail, function(err, mail) {
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
    , gmDate: mailUtils.getSentDate (parsedMail)
    , mailReaderState: 'started'
    , gmThreadId: gmThreadId
    , gmMsgId : gmMsgId
    , hasAttachment: hasAttachment
    , hasMarketingFrom: false
    , hasMarketingText: false
    , uid: uid
  });

  uid++;
  gmMsgId++;

  mail.save( function(err) {
    if ( err ) {
      callback( winston.makeMongoError( err ) );
      indexAttachment.cleanup();
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
          indexAttachment.handleParsedMail( parsedMail, function(err) {
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

    indexAttachment.checkAssertions (function (err) {
      if (err) {
        winston.handleError(err)
      }

      indexAttachment.cleanup();
    })

  });
}


exports.checkAssertions = function (callback) {
  // there should be 4 indexed attachments in the database
  AttachmentModel.find ({isIndexed: true}, function (err, attachments) {
    assert.equal(attachments.length, 4)
    callback()
  })

  // TODO: the indexed data should match the attachments
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

indexAttachment.run();