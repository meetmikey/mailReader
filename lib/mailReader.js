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

exports.ERR_DUPLICATE_MESSAGE = 'duplicate message';

exports.readMail = function(messageString, callback) {
  var message = JSON.parse(messageString);
  if ( ! message ) {
    callback();
  } else {
    if ( ! message.path ) {
      winston.error('mailReader: readMail: no path in message: ', message);
      callback();
    } else if ( ! message.userId ) {
      winston.error('mailReader: readMail: no userId in message: ', message);
      callback();
    } else {
      winston.info('got mailReader message: ', messageString);
      var emailPath = message.path;
      var userId = message.userId;

      //TEMP!
      userId = '50f75659017ec66733000004';
      
      var mailParser = new MailParser();
      mailParser.on('end', function(mail) {
        mailReader.processMail( mail, userId, function(err) {
          callback(err);
        });
      });

      s3Utils.client.getFile(emailPath, function(err, res) {
        if ( err ) {
          winston.error('mailReader: readMail: s3 error: ', err);
          callback(err);
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
      if ( err == mailReader.ERR_DUPLICATE_MESSAGE ) {
        winston.warn('mailReader: processMail: checkAndSaveMail return "duplicate message"');
        callback();
      } else {
        winston.error('mailReader: processMail: checkAndSaveMail error: ', err);
        callback(err);
      }
    } else {
      mailReader.uploadAttachments(mail, mailId, userId, function(err) {
        if ( err ) {
          winston.error('mailReader: processMail: error uploading attachments: ', err);
          callback(err);
        }
        callback();
        //extract links
      });
    }
  });
};

exports.uploadAttachments = function( mail, mailId, userId, callback ) {
  if ( mail.attachments && mail.attachments.length ) {
    async.forEach( mail.attachments, 
      function(attachment, forEachCallback) {
        mailReader.uploadAttachment(attachment, mail, mailId, userId, forEachCallback);
      },
      function(err) {
        callback(err);
      }
    );
  } else {
    callback();
  }
}

exports.uploadAttachment = function(attachment, mail, mailId, userId, callback) {
  //winston.info('uploadAttachment');

  var filename = attachment.fileName;
  var contentType = attachment.contentType;
  var size = attachment.length;
  var sender = mailUtils.getSender(mail);

  var dbAttachment = new AttachmentModel({
      userId: userId
    , mailId: mailId
    , filename: filename
    , contentType: contentType
    , size: size
    , sentDate: mailUtils.getSentDate(mail)
    , sender: sender
    //, image: image //If it's an image itself, we'll set a signedURL on this in the route.
  });

  var attachmentId = dbAttachment._id;

  var headers = {
    'Content-Type': attachment.contentType,
    'Content-Length': attachment.length,
    "x-amz-server-side-encryption" : "AES256",
    "Content-Disposition" : 'attachment; filename=' + attachment.fileName
  }
  var s3Path = mailReader.getAttachmentPath(attachmentId);
  s3Utils.client.putBuffer(attachment.content, s3Path, headers,
    function(err, res) {
      if ( err ) {
        winston.error('mailReader: uploadAttachment: s3 error: ' + err);
        callback(err);
      } else {
        //winston.info('saving attachment to db...');
        dbAttachment.save( function(err) {
          if ( utils.checkMongo(err, 'uploadAttachment', 'dbAttachment.save', callback) ) {
            //winston.info('attachment saved');
            callback(err);
          }
        });
      }
    }
  );
}

exports.getAttachmentPath = function(attachmentId) {
  return conf.aws.s3Folders.attachments + '/' + attachmentId;
}

//Check for existing mail, callback error if duplicate, otherwise save and callback...
exports.checkAndSaveMail = function( mail, userId, callback ) {

  //winston.info('checkAndSaveMail');

  if ( ! utils.checkParam(mail, 'mail', 'saveMail', callback) ) { return }
  if ( ! utils.checkParam(userId, 'userId', 'saveMail', callback) ) { return }

  var messageId = mailUtils.getMessageId(mail);
  if ( messageId ) {
    MailModel.findOne({'messageId':messageId}, function(err, foundMail) {
      if ( utils.checkMongo(err, 'saveMail', 'MailModel.findOne', callback) ) {
        if ( foundMail ) {
          winston.info('Info: mailReader: checkAndSaveMail: duplicate messageId: ' + messageId);
          callback(mailReader.ERR_DUPLICATE_MESSAGE, foundMail._id);
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