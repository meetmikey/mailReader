var serverCommon = process.env.SERVER_COMMON;

var conf = require(serverCommon + '/conf')
  , MailParser = require('mailparser').MailParser
  , fs = require('fs')
  , async = require('async')
  , s3Utils = require(serverCommon + '/lib/s3Utils')
  , utils = require(serverCommon + '/lib/utils')
  , mailUtils = require(serverCommon + '/lib/mailUtils')
  , winston = require (serverCommon + '/lib/winstonWrapper').winston
  , MailModel = require(serverCommon + '/schema/mail').MailModel
  , attachmentHandler = require('./attachmentHandler')
  , linkHandler = require('./linkHandler')


var mailReader = this;

exports.readMail = function(messageString, callback) {
  var message = JSON.parse(messageString);
  if ( ! message ) {
    callback();
  } else {
    if ( ! message.path ) {
      callback( winston.makeError('no path in message', {message: message}) );
    } else if ( ! message.userId ) {
      callback( winston.makeError('no userId in message', {message: message}) );
    } else {
      winston.info('got mailReader message: ', messageString);
      var emailPath = message.path;
      var userId = message.userId;

      //TEMP!
      userId = '51105236d50c88ebe8ef30cc';
      
      var mailParser = new MailParser();
      mailParser.on('end', function(mail) {
        mailReader.processMail( mail, userId, function(err) {
          callback(err);
        });
      });

      s3Utils.client.getFile(emailPath, function(err, res) {
        if ( err ) {
          callback( winston.makeS3Error(err) );
        } else {
          res.on('data', function(data) {
            mailParser.write(data);
          });
          res.on('end', function() {
            mailParser.end();
          });
        }
      });
    }
  }
}

exports.processMail = function( mail, userId, callback ) {
  winston.info('Subject: ', mail.subject );
  this.checkAndSaveMail(mail, userId, function(err, mailId) {
    if ( err ) {
      callback(err);
    } else if ( mailId ) {
      async.parallel([
        function(parallelCallback) {
          attachmentHandler.uploadAttachments(mail, mailId, userId, function(err) { parallelCallback(err); } );
        }
        , function(parallelCallback) {
          linkHandler.extractLinks(mail, mailId, userId, function(err) { parallelCallback(err); } );
        }], function(err) {
          callback(err);
        }
      )
    } else {
       //We expect to NOT get a mailId back if it was a duplicate message
       callback();
    }
  });
};

//Check for existing mail, callback with no mailId if duplicate, otherwise save and callback mailId
exports.checkAndSaveMail = function( mail, userId, callback ) {

  //winston.info('checkAndSaveMail');

  if ( ! mail ) { callback( winston.makeMissingParamError('mail') ); return; }
  if ( ! userId ) { callback( winston.makeMissingParamError('userId') ); return; }

  var messageId = mailUtils.getMessageId(mail);
  if ( messageId ) {
    MailModel.findOne({'messageId':messageId}, function(err, foundMail) {
      if ( err ) {
        callback( winston.makeMongoError(err) );
      } else {
        if ( foundMail ) {
          winston.info('mailReader: checkAndSaveMail: duplicate messageId: ' + messageId);
          callback();
        } else {
          mailReader.saveMail(mail, userId, function(err, mailId) {
            callback(err, mailId);
          });
        }
      }
    });
  } else {
    winston.warn('mailReader: checkAndSaveMail: no messageId, mail: ', mail);
    mailReader.saveMail(mail, userId, function(err, mailId) {
      callback(err, mailId);
    });
  }
}

exports.saveMail = function( mail, userId, callback ) {
  
  var sender = mailUtils.getSender(mail);
  var messageId = mailUtils.getMessageId(mail);
  var allRecipients = mailUtils.getAllRecipients(mail);
  var subject = mail.subject;
  var bodyText = mail.text;
  var bodyHTML = mail.html;
  var numAttachments = mailUtils.getNumAttachments(mail);
  var sentDate = mailUtils.getSentDate(mail);
  
  var dbMail = new MailModel({
      userId: userId
    , messageId: messageId
    , sender: sender
    , recipients: allRecipients
    , subject: subject
    , bodyText: bodyText
    , bodyHTML: bodyHTML
    , numAttachments: numAttachments
    , sentDate: sentDate
  });

  dbMail.save( function(err) {
    if ( err ) {
      callback( winston.makeMongoError(err) );
    } else {
      winston.info('mail saved');
      callback(null, dbMail._id);
    }
  });
}