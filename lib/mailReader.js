var serverCommon = process.env.SERVER_COMMON;

var MailParser = require('mailparser').MailParser
  , fs = require('fs')
  , mongoose = require('mongoose')
  , async = require('async')
  , s3Utils = require(serverCommon + '/lib/s3Utils')
  , utils = require(serverCommon + '/lib/utils')
  , mailUtils = require(serverCommon + '/lib/mailUtils')
  , winston = require (serverCommon + '/lib/winstonWrapper').winston
  , mailSchema = require('../schema/mail'), MailModel = mongoose.model('Mail')


var mailReader = this;

exports.readMail = function(messageString, callback) {
  var message = JSON.parse(messageString);
  if ( message ) {
    if ( ! message.path ) {
      winston.error('mailReader: readMail: no path in message: ', message);
    } else if ( ! message.userId ) {
      winston.error('mailReader: readMail: no userId in message: ', message);
    } else {
      winston.info('got mailReader message: ', messageString);
      var emailPath = message.path;
      var userId = message.userId;
      var mailParser = new MailParser();
      mailParser.on("end", function(mail) {
        mailReader.processMail( mail, userId );
      });
      fs.createReadStream( emailPath ).pipe( mailParser );
    }
  }
  callback();
}

exports.processMail = function( mail, userId ) {
  winston.info('Subject: ', mail.subject );
  this.checkAndSaveMail(mail, userId, function(err) {
    if ( err ) {
      winston.error('mailReader: processMail: saveMail failed: ', err);
    } else {
      mailReader.uploadAttachments(mail, userId, function(err) {
        if ( err ) {
          winston.error('mailReader: processMail: error uploading attachments: ', err);
        }
        //extract links
      });
    }
  });
};

exports.uploadAttachments = function( mail, userId, callback ) {
  var s3Client = s3Utils.client;
  if ( mail.attachments ) {
    async.forEach( mail.attachments, 
      function(attachment, forEachCallback) {
        mailReader.uploadAttachment(attachment, mail, userId, forEachCallback);
      },
      function(err) {
        callback(err);
      }
    );
  }
}

exports.uploadAttachment = function(attachment, mail, userId, callback) {
  winston.info('uploadAttachment: ', attachment);

}

//Check for existing mail, callback error if duplicate, otherwise save and callback...
exports.checkAndSaveMail = function( mail, userId, callback ) {

  winston.info('checkAndSaveMail');

  if ( ! utils.checkParam(mail, 'mail', 'saveMail', callback) ) { return }
  if ( ! utils.checkParam(userId, 'userId', 'saveMail', callback) ) { return }

  var messageId = null;
  if ( mail.headers['message-id'] ) {
    messageId = mail.headers['message-id'];
  }
  if ( messageId ) {
    MailModel.findOne({'messageId':messageId}, function(err, foundMail) {
      if ( utils.checkMongo(err, 'saveMail', 'MailModel.findOne', callback) ) {
        if ( foundMail ) {
          winston.info('Info: mailReader: checkAndSaveMail: duplicate messageId: ' + messageId);
          callback();
        } else {
          mailReader.saveMail(mail, userId, function(err) {
            callback(err);
          });
        }
      }
    });
  } else {
    winston.warn('mailReader: checkAndSaveMail: no messageId, mail: ', mail);
    mailReader.saveMail(mail, userId, function(err) {
      callback(err);
    });
  }
}

exports.saveMail = function( mail, userId, callback ) {
  
  var sender = { name: '', email: ''};
  if ( mail.from && ( mail.from.length > 0 ) ) {
    var fromAddressAndName = mail.from[0];
    sender.name = fromAddressAndName.name;
    sender.email = fromAddressAndName.address;
  }

  var messageId = null;
  if ( mail.headers['message-id'] ) {
    messageId = mail.headers['message-id'];
  }

  var toRecipients = mailUtils.getRecipients(mail.to);
  var ccRecipients = mailUtils.getRecipients(mail.cc);
  var allRecipients = toRecipients.concat(ccRecipients);

  var subject = mail.subject;
  var bodyText = mail.text;
  var bodyHTML = mail.html;
  var numAttachments = 0;
  if ( mail.attachments ) {
    numAttachments = mail.attachments.length;
  }
  var sentDate = null;
  if ( mail.headers['date'] ) {
    sentDate = new Date( Date.parse( mail.headers['date'] ) );
  }
  
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
    if ( utils.checkMongo(err, 'saveMail', 'dbMail.save', callback) ) {
      winston.info('mail saved');
      callback();
    }
  });
}