var MailParser = require('mailparser').MailParser
  , fs = require('fs')
  , mongoose = require('mongoose')
  , utils = require('../../serverCommon/lib/utils')
  , mailUtils = require('../../serverCommon/lib/mailUtils')
  , mailSchema = require('../schema/mail'), MailModel = mongoose.model('Mail')


var mailReader = this;

exports.readMail = function(messageString, callback) {
  var message = JSON.parse(messageString);
  if ( message ) {
    if ( ! message.path ) {
      console.error('Error: mailReader: readMail: no path in message: ', message);
    } else if ( ! message.userId ) {
      console.error('Error: mailReader: readMail: no userId in message: ', message);
    } else {
      console.log('got mailReader message: ', messageString);
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
  console.log('Subject: ', mail.subject );
  this.checkAndSaveMail(mail, userId, function(err) {
    if ( err ) {
      console.error('Error: mailReader: processMail: saveMail failed: ', err);
    } else {
      //save attachments
      //extract links
    }
  });
};

//Check for existing mail, callback error if duplicate, otherwise save and callback...
exports.checkAndSaveMail = function( mail, userId, callback ) {

  console.log('checkAndSaveMail');

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
          console.log('Info: mailReader: checkAndSaveMail: duplicate messageId: ' + messageId);
          callback();
        } else {
          mailReader.saveMail(mail, userId, function(err) {
            callback(err);
          });
        }
      }
    });
  } else {
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

  console.log('saving');

  dbMail.save( function(err) {
    if ( utils.checkMongo(err, 'saveMail', 'dbMail.save', callback) ) {
      console.log('SAVED!');
      callback();
    }
  });
}