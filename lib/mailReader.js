var serverCommon = process.env.SERVER_COMMON;

var conf = require(serverCommon + '/conf')
  , MailParser = require('mailparser').MailParser
  , fs = require('fs')
  , async = require('async')
  , s3Utils = require(serverCommon + '/lib/s3Utils')
  , utils = require(serverCommon + '/lib/utils')
  , mailUtils = require(serverCommon + '/lib/mailUtils')
  , winston = require (serverCommon + '/lib/winstonWrapper').winston
  , AttachmentModel = require(serverCommon + '/schema/attachment').AttachmentModel
  , MailModel = require(serverCommon + '/schema/mail').MailModel


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
  this.checkAndSaveMail(mail, userId, function(err, mailId) {
    if ( err ) {
      winston.error('mailReader: processMail: saveMail failed: ', err);
    } else {
      mailReader.uploadAttachments(mail, mailId, userId, function(err) {
        if ( err ) {
          winston.error('mailReader: processMail: error uploading attachments: ', err);
        }
        //extract links
      });
    }
  });
};

exports.uploadAttachments = function( mail, mailId, userId, callback ) {
  var s3Client = s3Utils.client;
  if ( mail.attachments ) {
    async.forEach( mail.attachments, 
      function(attachment, forEachCallback) {
        mailReader.uploadAttachment(attachment, mail, mailId, userId, forEachCallback);
      },
      function(err) {
        callback(err);
      }
    );
  }
}

exports.uploadAttachment = function(attachment, mail, mailId, userId, callback) {
  winston.info('uploadAttachment: ', attachment);

  var filename = attachment.fileName;
  var contentType = attachment.contentType;
  var size = attachment.length;
  var sender = mailUtils.getSender(mail);
  var image = mailUtils.getAttachmentImage(attachment);

  var dbAttachment = new AttachmentModel({
      userId: userId
    , mailId: mailId
    , filename: filename
    , contentType: contentType
    , size: size
    , sentDate: mailUtils.getSentDate(mail)
    , sender: sender
    , image: image
  });

  var attachmentId = dbAttachment._id;

  var headers = {
    'Content-Type': attachment.contentType,
    "x-amz-server-side-encryption" : "AES256",
    "Content-Disposition" : 'attachment; filename=' + attachment.fileName
  }
  s3Client.putStream(attachment.content, mailReader.getAttachmentPath(attachmentId), headers,
    function(err, res) {
      if ( err ) {
        winston.error('mailReader: uploadAttachment: s3 error: ', err);
        callback(err);
      } else {

      }
    }
  );
}

exports.getAttachmentPath = function(attachmentId) {
  return conf.aws.bucket + '/attachments/' + attachmentId;
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
          callback(null, foundMail._id);
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
    if ( utils.checkMongo(err, 'saveMail', 'dbMail.save', callback) ) {
      winston.info('mail saved');
      callback(null, dbMail._id);
    }
  });
}