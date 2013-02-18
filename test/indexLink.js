var serverCommon = process.env.SERVER_COMMON;

var mongoose = require(serverCommon + '/lib/mongooseConnect')
  , linkHandler = require('../lib/linkHandler')
  , mailReader = require('../lib/mailReader')
  , MailParser = require('mailparser').MailParser
  , fs = require('fs')
  , winston = require(serverCommon + '/lib/winstonWrapper').winston
  , MailModel = require(serverCommon + '/schema/mail').MailModel
  , LinkModel = require(serverCommon + '/schema/link').LinkModel
  , SentAndCoReceiveMRModel = require(serverCommon +'/schema/contact').SentAndCoReceiveMRModel
  , async = require('async')
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
var gmMsgId = '12345';
var uid = 1;
var mailParserDoneCallback;
var fromEmail = 'obama@dev.meetmikey.com'

var threadLink = this;


exports.handleParsedMail = function( parsedMail, callback ) {

  threadLink.createMail( parsedMail, function(err, mail) {
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
    , gmDate: mailUtils.getSentDate (parsedMail)
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
    } else {
      callback(null, mail);
    }
  });
}

exports.run = function() {

  winston.info('running...');

  // add contact info to database so that we process links
  var contact = new SentAndCoReceiveMRModel({
    _id : {
      email : fromEmail,
      userId : userId
    },
    value : {
      sent : 1,
      corecipient : 1
    }
  })

  contact.save (function (err) {

    if (err) {
      winston.doError ('could not create contact', {err: err})
      threadLink.cleanup() 
    }
    else {

      async.forEachSeries( emailFiles, function(emailFile, forEachSeriesCallback) {
        fs.readFile( emailFile, function(err, res) {
          if ( err ) {
            forEachSeriesCallback( winston.makeError('error reading file') );
            
          } else if ( ! res ) {
            forEachSeriesCallback( winston.makeMissingParamError('res') );

          } else {

            var mailParser = new MailParser();

            mailParser.on('end', function( parsedMail ) {
              threadLink.handleParsedMail( parsedMail, function(err) {
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
        threadLink.cleanup();
      });

    }
  })
}

exports.cleanup = function() {
  winston.info ('cleaning up')
  async.forEach( mailIds, function(mailId, forEachCallback) {
    LinkModel.find({mailId:mailId}).remove();
    MailModel.find({_id:mailId}).remove();
    forEachCallback();
  }, function(err) {
    if ( err ) {
      winston.handleError(err);
    } else {
      winston.info('cleanup done!');
    }
  });

  SentAndCoReceiveMRModel.find ({'_id.userId' : userId}).remove();
  /*SentAndCoReceiveMRModel.collection.findOne ({'_id.userId' : userId, '_id.email' : fromEmail}, function (err, foundContact) {
    winston.info ('here')
    console.log (foundContact)
  })*/
}

threadLink.run();